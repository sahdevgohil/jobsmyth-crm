import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
