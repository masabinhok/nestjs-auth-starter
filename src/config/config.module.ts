import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';
import { envSchema } from './env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: (config) => {
        const parsed = envSchema.safeParse(config);

        if (!parsed.success) {
          console.error('Invalid environment variables:');
          console.error(z.prettifyError(parsed.error));
          throw new Error('Environment validation failed');
        }

        return parsed.data;
      },
    }),
  ],
})
export class AppConfigModule {}
