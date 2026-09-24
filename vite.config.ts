import { defineConfig } from 'vitest/config';

// GitHub Pages ではリポジトリ名のサブパスで配信されるため、CI から BASE_PATH を渡す。
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  server: { host: true, port: 5173 },
  build: { target: 'es2023', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
