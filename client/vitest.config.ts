import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/setupTests.tsx',
        exclude: ['**/node_modules/**', '**/release/**', '**/dist/**', '**/e2e/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'clover', 'json-summary'],
            reportsDirectory: './coverage',
            include: ['src/**/*.{ts,tsx}', 'scripts/**/*.{js,ts}'],
            exclude: [
                'src/setupTests.tsx',
                'src/main.tsx',
                'src/vite-env.d.ts',
                '**/*.d.ts',
            ],
            thresholds: {
                statements: 40,
                branches: 35,
                functions: 35,
                lines: 40,
            },
        },
    },
})
