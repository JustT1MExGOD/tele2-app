/**
 * StorageAdapter для вложений мессенджера — структурно идентично
 * core/chat/storage.ts (то же обоснование: Postgres bytea, Railway —
 * эфемерная ФС), но не импортируется оттуда напрямую: архитектурная
 * граница модулей (scripts/check-architecture-boundaries.mjs) не
 * допускает cross-module импорт между core/chat и core/messenger,
 * поэтому у мессенджера свой адаптер, делегирующий в свой репозиторий.
 */
import * as messengerRepo from '../../data/repositories/messenger.js';

export interface StorageAdapter {
  put(storageKey: string, data: Buffer): Promise<void>;
  get(storageKey: string): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
}

class PostgresBlobStorageAdapter implements StorageAdapter {
  async put(storageKey: string, data: Buffer): Promise<void> {
    await messengerRepo.putBlob(storageKey, data);
  }

  async get(storageKey: string): Promise<Buffer | null> {
    return messengerRepo.getBlob(storageKey);
  }

  async delete(storageKey: string): Promise<void> {
    await messengerRepo.deleteBlob(storageKey);
  }
}

export const messengerStorage: StorageAdapter = new PostgresBlobStorageAdapter();
