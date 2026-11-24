import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  configureApp(app);

  const port = app.get(ConfigService).get<number>('PORT') || 8080;
  await app.listen(port);

  app
    .get(Logger)
    .log(
      `🚀 Application is running on: http://localhost:${port}/api/v1`,
      'Bootstrap',
    );
}
void bootstrap();
