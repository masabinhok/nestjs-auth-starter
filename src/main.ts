import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadEnv } from './config/env.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, env);
  await app.listen(env.PORT);

  const url = await app.getUrl();
  app
    .get(Logger)
    .log(
      `API ready at ${url}/api/v1${env.API_DOCS ? ` · docs at ${url}/docs` : ''}`,
      'Bootstrap',
    );
}

void bootstrap();
