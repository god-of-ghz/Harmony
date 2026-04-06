import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

import { configDefaults } from 'vitest/config'

const isE2E = process.env.E2E === 'true';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    !isE2E && electron([
      {
        entry: 'electron/main.ts',
      },
    ]),
    renderer(),
  ].filter(Boolean) as any,
  test: {
    exclude: [...configDefaults.exclude, '**/release/**']
  }
})
