import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthenticationModule } from '@nestjs/authentication';
import { AuthorizationModule } from '@nestjs/authorization';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './config/env.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { MailModule } from './infra/mail/mail.module.js';
import { loggerParams } from './infra/logging/logger.config.js';
import { RedisThrottlerStorage } from './infra/throttling/redis-throttler.storage.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';
import { authenticationOptions } from './auth/auth.options.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { HealthModule } from './health/health.module.js';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot(loggerParams(env)),
    DatabaseModule,
    MailModule,
    ThrottlerModule.forRoot({
      // Each route can tighten this with @Throttle(); auth routes do.
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      storage: env.REDIS_URL
        ? new RedisThrottlerStorage(env.REDIS_URL)
        : undefined,
    }),
    // Order matters: authentication's guard runs before authorization's.
    AuthenticationModule.forRoot(authenticationOptions(env)),
    AuthorizationModule.forRoot(),
    AuditModule,
    AuthModule.forRoot(env),
    UsersModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
