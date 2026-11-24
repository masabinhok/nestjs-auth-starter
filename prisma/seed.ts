/**
 * Development seed: an admin and a regular user with verified emails.
 *
 *   pnpm prisma:seed
 *
 * Refuses to run with NODE_ENV=production. Set SEED_ADMIN_PASSWORD to choose
 * the admin password; otherwise a random one is generated and printed.
 */
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PasswordHasher } from '@nestjs/authentication';
import { PrismaClient } from '../src/generated/prisma/client.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const hasher = new PasswordHasher();

async function upsertUser(
  email: string,
  fullName: string,
  role: 'ADMIN' | 'USER',
  password: string,
) {
  const passwordHash = await hasher.hash(password);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role, isActive: true },
    create: {
      email,
      fullName,
      role,
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  const userPassword = process.env.SEED_USER_PASSWORD ?? 'user-password-123';

  await upsertUser(adminEmail, 'Admin', 'ADMIN', adminPassword);
  await upsertUser('user@example.com', 'Demo User', 'USER', userPassword);

  console.log('Seeded development users:');
  console.log(`  admin  ${adminEmail} / ${adminPassword}`);
  console.log(`  user   user@example.com / ${userPassword}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
