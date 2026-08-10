import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Изоляционные тесты пишут в реальную (тестовую) БД через реальные роуты —
    // параллельные файлы делят один Postgres, поэтому гоняем последовательно,
    // чтобы фикстуры разных файлов не путались друг у друга под ногами.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000
  }
});
