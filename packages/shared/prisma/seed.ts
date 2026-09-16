import bcrypt from 'bcrypt';
import { prisma } from '../src/prisma';

/**
 * Seeds the two accounts anyone exploring TaskFlow needs: one ADMIN and
 * one regular USER. `upsert` makes this safe to re-run — re-seeding never
 * duplicates accounts or errors on a unique constraint.
 *
 * These are development-only credentials, documented as such in the
 * README. Never used, referenced, or valid in a production deployment —
 * production seeding, if ever needed, should generate and print a random
 * password instead of using a fixed one.
 */
async function main() {
  const adminPasswordHash = await bcrypt.hash('Admin123!', 12);
  const userPasswordHash = await bcrypt.hash('User123!', 12);

  await prisma.user.upsert({
    where: { email: 'admin@taskflow.dev' },
    update: {},
    create: {
      name: 'TaskFlow Admin',
      email: 'admin@taskflow.dev',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'user@taskflow.dev' },
    update: {},
    create: {
      name: 'Demo User',
      email: 'user@taskflow.dev',
      passwordHash: userPasswordHash,
      role: 'USER',
    },
  });

  // Job/schedule seed data is added once those models are actually
  // populated by real application code (Phase 3+) — seeding rows for a
  // feature that doesn't exist yet would just be fake data pretending to
  // demonstrate something that isn't built.
  // eslint-disable-next-line no-console
  console.log('Seed complete: admin@taskflow.dev / user@taskflow.dev (see README for passwords)');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
