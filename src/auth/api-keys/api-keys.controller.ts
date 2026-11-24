import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { clientInfo } from '../../common/http.js';
import type { AuthUser } from '../auth.types.js';
import { ApiKeyAuthProvider } from '../providers/api-key-auth.provider.js';
import { JwtAuthProvider } from '../providers/jwt-auth.provider.js';
import { SessionAuthProvider } from '../providers/session-auth.provider.js';
import {
  ApiKeyDto,
  CreateApiKeyDto,
  CreatedApiKeyDto,
} from '../dto/auth.dto.js';

const DAY = 86_400_000;

/**
 * Personal API keys for scripts and integrations. Managing keys needs a
 * real sign-in: an API key can't mint or revoke keys.
 */
@ApiTags('api-keys')
@Can.Anyone()
@Authenticate({ providers: [SessionAuthProvider, JwtAuthProvider] })
@Controller('auth/api-keys')
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ApiKeyAuthProvider,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<ApiKeyDto[]> {
    return this.prisma.apiKey.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    });
  }

  /** The whole key is in this response only. */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request,
  ): Promise<CreatedApiKeyDto> {
    const generated = this.provider.generate();
    const key = await this.prisma.apiKey.create({
      data: {
        id: generated.id,
        hash: generated.hash,
        name: dto.name,
        userId: user.id,
        expiresAt: dto.expiresInDays
          ? new Date(Date.now() + dto.expiresInDays * DAY)
          : null,
      },
    });
    await this.audit.record({
      type: 'api-key-created',
      userId: user.id,
      ipAddress: clientInfo(req).ip,
      data: { keyId: key.id, name: key.name },
    });
    return {
      id: key.id,
      name: key.name,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      key: generated.key,
    };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException('API key not found');
    }
    await this.audit.record({
      type: 'api-key-revoked',
      userId: user.id,
      ipAddress: clientInfo(req).ip,
      data: { keyId: id },
    });
  }
}
