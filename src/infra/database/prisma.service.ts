import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

/**
 * Prisma 7 talks to Postgres through the `pg` driver adapter. The client
 * connects on first query, so tools that only build the app (OpenAPI export)
 * need no database.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@InjectEnv() env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
