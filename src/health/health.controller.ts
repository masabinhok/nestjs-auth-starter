import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../infra/database/prisma.service.js';

/** Probes run every few seconds: public and never rate limited. */
@ApiTags('health')
@Public()
@Can.Anyone()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /** Readiness: the database answers within 1.5 s. */
  @Get()
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database', this.prisma).withTimeout(1500),
    ]);
  }

  /** Liveness: the process is serving requests. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
