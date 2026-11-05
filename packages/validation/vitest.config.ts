import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Явный алиас на исходники workspace-пакета — витест не тянуть его из node_modules.
export default defineConfig({
  resolve: {
    alias: {
      '@agromoll/types': resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
