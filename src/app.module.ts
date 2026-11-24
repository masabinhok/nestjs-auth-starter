import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module.js';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AppConfigModule } from './config/config.module.js';
import { loggerConfig } from './config/logger.config.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    // Every named throttler applies to every route, so there is one global
    // limit here; auth routes tighten it with @Throttle().
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1 minute
        limit: 100,
      },
    ]),
    AppConfigModule,
    AuthModule,
    UsersModule,
    HealthModule,
    PrismaModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
