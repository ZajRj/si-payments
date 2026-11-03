import { defineConfig } from 'vitest/config';
import { testEnv } from './tests/test-env.js';

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: './tests/global-setup.ts',
    include: ['tests/**/*.test.ts'],
  },
});
