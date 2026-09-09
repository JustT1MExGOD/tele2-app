/**
 * Generic HTTP transport for the typed API client (extracted from the former
 * api-client.ts god-file, 20.58.0 architecture split). CSRF handling,
 * request/response envelope, and error parsing live here ONCE — every
 * capability module under features/&lt;name&gt;/api.ts imports request()/requestBlob()/
 * requestUpload() from here rather than reimplementing them.
 *
 * Sознательно бросает на не-ok/сетевой ошибке, не глотает и не подставляет
 * фолбэк сам — это остаётся ответственностью вызывающего кода (не изменено
 * при переносе из api-client.ts).
 */

function readCsrfCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)t2_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function request<T>(
  path: string,
  headers: Record<string, string>,
  init?: { method: string; body?: unknown }
): Promise<T> {
  const mutating = !!init?.method && init.method !== 'GET';
  const csrf = mutating ? readCsrfCookie() : null;
  const res = await fetch(window.location.origin + path, {
    headers: csrf ? { ...headers, 'X-CSRF-Token': csrf } : headers,
    ...(init ? { method: init.method, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) } : {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const message = (data.message as string) || (data.error as string) || `api_error:${path}:${res.status}`;
    // .code — машиночитаемый error-код ответа (напр. invalid_attachment,
    // hotfix 20.57.1 PASS 2, finding #4/#3) — .message остаётся человеко-
    // читаемым текстом для toast(), существующие вызывающие не затронуты.
    // .definitive=true — сервер реально ответил (получен HTTP-статус,
    // прошёл до валидации), т.е. это настоящий отказ, а не потерянный
    // транспорт (hotfix 20.57.2 AMBIGUOUS DELIVERY). Ошибка от самого
    // fetch() (сеть недоступна) или от парсинга res.json() ниже (ответ на
    // успешный статус потерян/повреждён) этот флаг не несёт — это
    // единственный надёжный различитель.
    throw Object.assign(new Error(message), { code: data.error as string | undefined, definitive: true });
  }
  return res.json() as Promise<T>;
}


/** CSV-экспорт (Content-Disposition: attachment) — тело не JSON, отдаём Blob как есть. */
export async function requestBlob(path: string, headers: Record<string, string>): Promise<Blob> {
  const res = await fetch(window.location.origin + path, { headers });
  if (!res.ok) throw new Error(`api_error:${path}:${res.status}`);
  return res.blob();
}


/**
 * Загрузка файла (multipart/form-data) — тело нельзя JSON.stringify.
 * Всегда POST, то есть всегда mutating (см. request() выше) — CSRF-токен
 * обязателен на тех же условиях, иначе браузерная/Electron cookie-сессия
 * получает 403 csrf_mismatch на КАЖДОЙ загрузке (requireCsrf — глобальный
 * preHandler, backend/src/app.ts, исключений для /chat/attachments и
 * /me/avatar нет). Content-Type НЕ выставляется вручную — fetch сам
 * генерирует multipart/form-data с boundary для FormData-тела.
 */
export async function requestUpload<T>(path: string, headers: Record<string, string>, form: FormData): Promise<T> {
  const csrf = readCsrfCookie();
  const res = await fetch(window.location.origin + path, {
    method: 'POST',
    headers: csrf ? { ...headers, 'X-CSRF-Token': csrf } : headers,
    body: form
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const message = (data.message as string) || (data.error as string) || `api_error:${path}:${res.status}`;
    throw Object.assign(new Error(message), { code: data.error as string | undefined });
  }
  return res.json() as Promise<T>;
}

export async function exportCsv(headers: Record<string, string>, path: string): Promise<Blob> {
  return requestBlob(path, headers);
}
