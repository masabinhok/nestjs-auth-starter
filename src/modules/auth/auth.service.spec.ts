import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

describe('AuthService', () => {
  let service: AuthService;
  const prisma = {
    user: { findUnique: vi.fn(), create: vi.fn() },
    refreshToken: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: vi.fn() } },
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: Logger, useValue: { log: vi.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('rejects login for an unknown email without revealing it', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'nobody@example.com', password: 'x' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
  });
});
