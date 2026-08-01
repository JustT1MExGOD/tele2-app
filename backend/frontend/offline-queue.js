/**
 * Офлайн-очередь продаж для T2 Mini App
 * Подключи в index.html: <script src="/offline-queue.js"></script>
 *
 * API:
 *   OfflineQueue.enqueueSale({ store_id, metrics, sale_date? })
 *   OfflineQueue.flush()
 *   OfflineQueue.pendingCount()
 */
(function (global) {
  const DB_NAME = 't2_offline_v1';
  const STORE = 'ops';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'client_id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function allOps() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function putOp(op) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(op);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function removeOp(client_id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(client_id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function enqueueSale(payload) {
    const op = {
      client_id: uuid(),
      type: 'sale',
      created_at: new Date().toISOString(),
      store_id: payload.store_id,
      employee_id: payload.employee_id,
      sale_date: payload.sale_date,
      metrics: payload.metrics || {}
    };
    await putOp(op);
    // пробуем сразу синкнуть
    flush().catch(() => {});
    return op;
  }

  async function pendingCount() {
    const ops = await allOps();
    return ops.length;
  }

  async function flush() {
    if (!navigator.onLine) return { skipped: true };
    const ops = await allOps();
    if (!ops.length) return { ok: true, count: 0 };

    const API = global.API || '';
    const headers = typeof global.authHeaders === 'function'
      ? global.authHeaders(true)
      : { 'Content-Type': 'application/json' };

    const res = await fetch(API + '/sync/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ops })
    });
    if (!res.ok) throw new Error('sync failed');
    const data = await res.json();
    for (const r of data.results || []) {
      if (r.status === 'applied' || r.status === 'duplicate') {
        await removeOp(r.client_id);
      }
    }
    return data;
  }

  global.addEventListener('online', () => {
    flush().catch(() => {});
  });

  // периодический flush
  setInterval(() => {
    flush().catch(() => {});
  }, 30000);

  global.OfflineQueue = {
    enqueueSale,
    flush,
    pendingCount,
    allOps
  };
})(window);
