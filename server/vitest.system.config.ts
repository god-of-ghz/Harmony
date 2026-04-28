import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for SYSTEM / INTEGRATION tests only.
 *
 * Usage:
 *   npx vitest run --config vitest.system.config.ts
 *   npx vitest run --config vitest.system.config.ts --coverage
 *
 * This config includes only the heavy integration tests (system.test.ts,
 * federated_auth_system.test.ts) and produces a separate coverage report
 * so you can see exactly which production code paths are exercised by
 * end-to-end flows through the real Express app + SQLite stack.
 */
export default defineConfig({
  test: {
    include: [
      'tests/system.test.ts',
      'tests/federated_auth_system.test.ts',
      'tests/global_profile_displayname_system.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    // System tests manage their own PKI & data dirs — no global setup needed
    setupFiles: [],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json-summary'],
      reportsDirectory: './coverage-system',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/cli.ts',
        'src/cli/**',
        'src/elevate.ts',
        'src/scripts/**',
        'src/server.ts',
        'src/setup.ts',
        'src/test_*.ts',
      ],
    },
  },
});
