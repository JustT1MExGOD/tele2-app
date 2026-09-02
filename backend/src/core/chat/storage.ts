/**
 * StorageAdapter — граница между чатом и конкретным блоб-хранилищем
 * (§10/§38 брифа). Ни один вызывающий код (routes/service) не знает, ГДЕ
 * физически лежат байты — только put/get/delete по storage_key.
 *
 * Дефолтная и единственная реализация сейчас — Postgres bytea
 * (chat_attachment_blobs, 0026_chat.sql), тем же обоснованием, что уже
 * применено к employees.avatar_data (0010_employees_avatar.sql): Railway —
 * эфемерная ФС, S3/CDN не подключены (npm ls подтверждает — ни aws-sdk,
 * ни @aws-sdk/* нет в зависимостях). Это НЕ временная заглушка "пока нет
 * S3" — для аватарок тот же паттерн уже год в проде. Реальный блокер —
 * объём: аватарки ограничены 1.5MB, вложения чата — до 20MB × 5 на
 * сообщение, при заметном использовании чата это заметно раздует БД.
 * Адаптер существует именно для того, чтобы переезд на настоящий
 * S3-compatible storage (CHAT_STORAGE_* env, см. финальный отчёт) был
 * заменой ОДНОГО файла, а не переписыванием routes/service/схемы.
 */
import * as chatRepo from '../../data/repositories/chat.js';

export interface StorageAdapter {
  put(storageKey: string, data: Buffer): Promise<void>;
  get(storageKey: string): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
}

class PostgresBlobStorageAdapter implements StorageAdapter {
  async put(storageKey: string, data: Buffer): Promise<void> {
    await chatRepo.putBlob(storageKey, data);
  }

  async get(storageKey: string): Promise<Buffer | null> {
    return chatRepo.getBlob(storageKey);
  }

  async delete(storageKey: string): Promise<void> {
    await chatRepo.deleteBlob(storageKey);
  }
}

export const chatStorage: StorageAdapter = new PostgresBlobStorageAdapter();
