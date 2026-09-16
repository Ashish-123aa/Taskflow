import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
    // Handler tests import config/env.ts transitively (e.g. email.handler.ts
    // → config/mail.ts → config/env.ts), whose module-level validation
    // requires DATABASE_URL/REDIS_URL even though these particular tests
    // never touch either. Providing harmless dummy values here means every
    // handler test can import normally without each one having to fake an
    // env setup just to satisfy a schema it doesn't actually depend on.
    env: {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/taskflow_test',
      REDIS_URL: 'redis://localhost:6379',
    },
  },
});
