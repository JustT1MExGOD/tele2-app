import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // frontend/ имеет собственный vitest.config.ts (jsdom, npm run test:frontend) —
    // без этого дефолтный include подхватил бы и его тесты тоже. Свой exclude
    // заменяет дефолтный список vitest целиком, поэтому переносим его сюда явно.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'frontend/**'
    ],
    setupFiles: ['./tests/setup.ts'],
    // Изоляционные тесты пишут в реальную (тестовую) БД через реальные роуты —
    // параллельные файлы делят один Postgres, поэтому гоняем последовательно,
    // чтобы фикстуры разных файлов не путались друг у друга под ногами.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000
  }
});
