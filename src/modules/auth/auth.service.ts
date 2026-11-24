import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from 'generated/prisma/client';
import { Logger } from 'nestjs-pino';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto } from './dtos/login.dto';
import { parseDuration } from 'src/common/utils/duration';

const BCRYPT_ROUNDS = 12;
const MAX_SESSIONS_PER_USER = 5;

export interface ClientInfo {
  deviceInfo?: string;
  ipAddress?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** Compared against on unknown emails so response time doesn't reveal them. */
  private readonly dummyHash = bcrypt.hashSync(
    'dummy-password-to-prevent-timing-attack',
    BCRYPT_ROUNDS,
  );

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private logger: Logger,
  ) {}

  get accessTokenTtlMs(): number {
    return parseDuration(this.config.get<string>('JWT_ACCESS_EXPIRY') ?? '15m');
  }

  get refreshTokenTtlMs(): number {
    return parseDuration(
      this.config.get<string>('JWT_REFRESH_EXPIRY') ?? '30d',
    );
  }

  async signup(signupDto: SignupDto) {
    const { email, password, fullName } = signupDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const newUser = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        fullName,
      },
    });

    // Log without PII (email address)
    this.logger.log({
      message: 'New user registered',
      userId: newUser.id,
      role: newUser.role,
    });

    return {
      user: this.publicUser(newUser),
      message: 'User registered successfully',
    };
  }

  async login(loginDto: LoginDto, client: ClientInfo = {}) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always run a bcrypt compare so unknown emails take as long as known ones.
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? this.dummyHash,
    );

    // Use consistent error message to prevent account enumeration
    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user, randomUUID(), client);
    await this.pruneSessions(user.id);

    this.logger.log({ message: 'User logged in', userId: user.id });

    return { user: this.publicUser(user), ...tokens };
  }

  /**
   * Rotates a refresh token. Each token can be used once; presenting a token
   * that was already rotated means it leaked, so the whole family is revoked.
   */
  async refreshToken(
    presentedToken: string,
    client: ClientInfo = {},
  ): Promise<IssuedTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(presentedToken) },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      this.logger.warn({
        message: 'Refresh token reuse detected; session family revoked',
        userId: stored.userId,
        familyId: stored.familyId,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revoke only if nobody else rotated it first (concurrent refresh).
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(stored.user, stored.familyId, client);
  }

  /** Revokes the session the presented refresh token belongs to, if any. */
  async logout(presentedToken?: string) {
    if (presentedToken) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: this.hashToken(presentedToken) },
      });
      if (stored) {
        await this.revokeFamily(stored.familyId);
      }
    }
    return { message: 'Logged out successfully' };
  }

  /** Signs the user out of every device. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.publicUser(user);
  }

  // Helper Methods

  private publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(
    user: User,
    familyId: string,
    client: ClientInfo,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, role: user.role, email: user.email },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: Math.floor(this.accessTokenTtlMs / 1000),
      },
    );

    const refreshToken = randomBytes(32).toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(refreshToken),
        familyId,
        userId: user.id,
        deviceInfo: client.deviceInfo?.slice(0, 255) ?? 'Unknown Device',
        ipAddress: client.ipAddress?.slice(0, 45) ?? 'Unknown IP',
        expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
      },
    });

    return { accessToken, refreshToken };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { familyId } });
  }

  /**
   * Drops expired rows and keeps the newest sessions per user. Revoked rows
   * stay until they expire so a replayed token is still recognised.
   */
  private async pruneSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    const active = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true },
    });
    const families = [...new Set(active.map((t) => t.familyId))];
    const stale = families.slice(MAX_SESSIONS_PER_USER);
    if (stale.length > 0) {
      await this.prisma.refreshToken.deleteMany({
        where: { familyId: { in: stale } },
      });
    }
  }
}
