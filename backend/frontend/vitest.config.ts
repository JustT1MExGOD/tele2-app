import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts']
  }
});
