import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { PrismaService } from 'src/prisma/prisma.service';

export const PASSWORD = 'Str0ng!Passw0rd';

/** In-memory throttler storage that tests can reset between cases. */
class ResettableThrottlerStorage implements ThrottlerStorage {
  private inner = new ThrottlerStorageService();

  increment(...args: Parameters<ThrottlerStorage['increment']>) {
    return this.inner.increment(...args);
  }

  reset(): void {
    this.inner = new ThrottlerStorageService();
  }
}

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ThrottlerStorage)
    .useValue(new ResettableThrottlerStorage())
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();
  return app;
}

/** Clears in-memory rate-limit counters so tests don't throttle each other. */
export function resetThrottle(app: INestApplication): void {
  app.get<ResettableThrottlerStorage>(ThrottlerStorage).reset();
}

export async function resetDb(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

export async function createAdmin(
  app: INestApplication,
  email = 'admin@example.com',
): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.user.create({
    data: {
      email,
      fullName: 'Admin',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    },
  });
}

export function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split(';')[0]);
}

export function cookieValue(
  cookies: string[],
  name: string,
): string | undefined {
  return cookies.find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}
