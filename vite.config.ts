import { defineConfig } from 'vitest/config';

// Relative base so the static build works on GitHub Pages under
// /financilab-near-payment-guard/ and from any sub-path or file server.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { port: 5173 },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
