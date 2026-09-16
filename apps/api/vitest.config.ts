import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
    // Auth tests hit a real Postgres instance through Prisma (no mocking
    // the ORM) — that's a deliberate choice: a mocked Prisma client would
    // only prove the mock behaves as expected, not that registration,
    // uniqueness constraints, and login actually work end-to-end.
    // Requires `docker compose up -d postgres` and a migrated database
    // pointed at by DATABASE_URL / a .env.test override.
  },
});
