import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { isPublic as IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ACCESS_TOKEN_COOKIE } from '../constants/cookie.config.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      cookies?: Record<string, string>;
      user?: unknown;
    }>();
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE];

    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Access Token missing or malformed');
    }

    try {
      const payload: unknown = await this.jwtService.verifyAsync(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });

      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired Access Token');
    }
  }
}
