import './env.js'; // должен быть первым — см. комментарий в env.ts
import { runMigrations } from './db/migrate.js';

runMigrations()
  .then(({ applied }) => {
    if (applied.length) console.log('Применены миграции:', applied.join(', '));
    else console.log('Нет новых миграций — схема уже актуальна.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Миграция не прошла:', e?.message || e);
    process.exit(1);
  });
