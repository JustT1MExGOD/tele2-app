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

  let database;
  let inFlight;
  function openDb() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'client_id' });
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); database = null; };
        resolve(req.result);
      };
      req.onerror = () => { database=null; reject(req.error); };
    });
    return database;
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
    // client_id по возможности — от вызывающего кода (тот же ключ, что уже
    // ушёл в неудавшийся POST /sales): если запрос на самом деле дошёл до
    // сервера и применился, а клиент просто не увидел ответ (сеть
    // оборвалась после), /sync/batch увидит тот же client_id уже занятым
    // и отдаст 'duplicate' вместо повторного применения — без этого
    // очередь сгенерировала бы новый ключ и задвоила сумму продажи.
    const op = {
      client_id: payload.client_id || uuid(),
      type: 'sale',
      created_at: new Date().toISOString(),
      store_id: payload.store_id,
      employee_id: payload.employee_id,
      sale_date: payload.sale_date,
      metrics: payload.metrics || {}
    };
    await putOp(op);
    updateQueueBadge().catch(() => {});
    // пробуем сразу синкнуть
    flush().catch(() => {});
    return op;
  }

  async function pendingCount() {
    const db=await openDb();
    return new Promise((resolve,reject) => {
      const request=db.transaction(STORE,'readonly').objectStore(STORE).count();
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }

  async function updateQueueBadge() {
    if (!document.body) return;
    const count=await pendingCount();
    let button=document.getElementById('offlineQueueStatus');
    if (!button && count) {
      button=document.createElement('button');button.id='offlineQueueStatus';button.type='button';
      button.className='btn secondary';button.setAttribute('aria-live','polite');
      Object.assign(button.style,{position:'fixed',bottom:'calc(76px + env(safe-area-inset-bottom))',right:'12px',zIndex:'900',maxWidth:'calc(100vw - 24px)'});
      button.addEventListener('click',()=>showQueue().catch(()=>{}));document.body.append(button);
    }
    if(button) {button.hidden=!count;button.textContent=`Не отправлено: ${count} · Подробнее`;}
  }

  async function showQueue() {
    document.getElementById('offlineQueueDialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='offlineQueueDialog';
    dialog.setAttribute('aria-labelledby','offlineQueueTitle');
    Object.assign(dialog.style,{maxWidth:'min(540px,92vw)',maxHeight:'80vh',overflow:'auto',borderRadius:'16px',padding:'20px'});
    const heading=document.createElement('h2');heading.id='offlineQueueTitle';heading.textContent='Неотправленные продажи';dialog.append(heading);
    const note=document.createElement('p');note.textContent='Эти записи ещё не подтверждены сервером. Автоматически повторяем временные ошибки. Записи с постоянной ошибкой сохраняются для сверки.';dialog.append(note);
    const operations=await allOps();
    for(const op of operations.slice(0,100)) {
      const row=document.createElement('section');
      const label=document.createElement('p');label.textContent=`${op.sale_date || op.created_at?.slice(0,10) || ''} · ${op.store_id || 'Точка не указана'} · ${Object.entries(op.metrics || {}).map(([k,v])=>`${k}: ${v}`).join(', ')}`;row.append(label);
      if(op.error) {const error=document.createElement('p');error.textContent=op.error;row.append(error);}
      if(op.failed) {
        const retry=document.createElement('button');retry.type='button';retry.textContent='Повторить после исправления причины';
        retry.addEventListener('click',async()=>{retry.disabled=true;try {await global.OfflineQueue.retry(op.client_id);dialog.close();await showQueue();} catch {retry.disabled=false;}});row.append(retry);
      }
      dialog.append(row);
    }
    if(operations.length>100) {const note=document.createElement('p');note.textContent='Показаны первые 100 записей; остальные остаются в очереди.';dialog.append(note);}
    const retryAll=document.createElement('button');retryAll.type='button';retryAll.textContent='Отправить ожидающие';
    retryAll.addEventListener('click',async()=>{retryAll.disabled=true;try{await flush();dialog.close();await showQueue();}catch{retryAll.disabled=false;note.textContent='Связь с сервером отсутствует. Записи сохранены на устройстве.';}});
    const close=document.createElement('button');close.type='button';close.textContent='Закрыть';close.addEventListener('click',()=>dialog.close());
    dialog.append(retryAll,close);dialog.addEventListener('close',()=>{dialog.remove();document.getElementById('offlineQueueStatus')?.focus();});
    document.body.append(dialog);dialog.showModal();close.focus();
  }

  /**
   * §P1-G (20.54.0) — account isolation. The queue (IndexedDB, one
   * store for the whole browser) was never scoped to a session/identity
   * and nothing cleared it on logout: User A queues an offline sale on
   * a shared device, logs out before the network comes back, User B
   * logs in on the same device, and the `online` listener/30s interval
   * below would flush User A's still-pending op under whatever
   * cookie/headers happen to be current — a manager session (B) could
   * silently submit A's stale queued sale. The server-side authorization
   * in /sync/batch (api/routes/shifts.ts) already refuses to let a
   * non-manager sync someone else's employee_id, so a plain-employee B
   * is safe (the op just fails and lingers) — but a manager B is not.
   * Call this from every logout path BEFORE clearing the session cookie,
   * never after: it deletes whatever a best-effort flush() didn't
   * manage to send, so nothing queued under the old identity survives
   * to replay under the next one.
   */
  async function clear() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function flush() {
    if (inFlight) return inFlight;
    inFlight = flushBatch().finally(() => { inFlight=null; updateQueueBadge().catch(() => {}); });
    return inFlight;
  }

  async function flushBatch() {
    if (!navigator.onLine) return { skipped: true };
    const ops = (await allOps()).filter(op => !op.failed && (!op.retry_at || op.retry_at <= Date.now()))
      .sort((a,b) => String(a.created_at).localeCompare(String(b.created_at))).slice(0,50);
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
      } else {
        const op = ops.find(op => op.client_id === r.client_id);
        if (op) await putOp({...op, failed:r.retryable === false, error:r.error || 'Не удалось сохранить',
          attempts:(op.attempts || 0)+1,retry_at:Date.now()+Math.min(300000,30000*2**Math.min(op.attempts || 0,4))});
      }
    }
    global.dispatchEvent(new CustomEvent('t2:sync-status', {detail:{pending:await pendingCount()}}));
    return data;
  }

  document.addEventListener('DOMContentLoaded',()=>updateQueueBadge().catch(()=>{}));
  if(document.readyState!=='loading') updateQueueBadge().catch(()=>{});

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
    async retry(client_id) {
      const op=(await allOps()).find(op => op.client_id === client_id);
      if(op) await putOp({...op,failed:false,retry_at:0});
      return flush();
    },
    allOps,
    clear
  };
})(window);
