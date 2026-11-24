import { Global, Inject, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env.js';

export const ENV = Symbol('ENV');

/** Injects the validated environment: `@InjectEnv() env: Env`. */
export const InjectEnv = () => Inject(ENV);

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
