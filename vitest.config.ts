import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globalSetup: ['__tests__/setup/globalSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
