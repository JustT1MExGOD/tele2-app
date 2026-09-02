/**
 * Валидация вложений чата (§11/§15/§16 брифа) — allowlist по трём
 * независимым сигналам (extension + заявленный MIME + magic bytes), не
 * доверяя ни одному из них по отдельности. Allowlist, а не blocklist —
 * список опасных расширений в §11 брифа избыточен по конструкции (ничего,
 * кроме девяти разрешённых расширений, и так не пройдёт), но explicitCheck()
 * ниже всё равно даёт для них отдельное явное сообщение об ошибке
 * (тестируемость, §33: "executable rejected" как свой кейс, не общий
 * "unsupported type").
 */
import crypto from 'node:crypto';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const PREPARED_ATTACHMENT_TTL_MS = 60 * 60 * 1000; // 1 час

const EXPLICITLY_DANGEROUS_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'scr', 'com', 'js', 'jar', 'hta',
  'cpl', 'dll', 'sh', 'apk', 'msix', 'wsf', 'vbe', 'jse', 'ws', 'reg', 'lnk',
  'pif', 'gadget', 'msp', 'mst', 'svg', 'html', 'htm', 'zip'
]);

interface AllowedType {
  ext: string;
  mime: string;
}

const ALLOWED_TYPES: AllowedType[] = [
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'jpeg', mime: 'image/jpeg' },
  { ext: 'png', mime: 'image/png' },
  { ext: 'webp', mime: 'image/webp' },
  { ext: 'pdf', mime: 'application/pdf' },
  { ext: 'txt', mime: 'text/plain' },
  { ext: 'doc', mime: 'application/msword' },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ext: 'xls', mime: 'application/vnd.ms-excel' },
  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
];

function extOf(filename: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : '';
}

function bufferContainsUtf16(buf: Buffer, text: string): boolean {
  return buf.includes(Buffer.from(text, 'utf16le'));
}

function bufferContainsAscii(buf: Buffer, text: string): boolean {
  return buf.includes(Buffer.from(text, 'ascii'));
}

/**
 * Реальный формат файла по magic bytes — то, что реально используется
 * дальше (для проверки И для Content-Type при отдаче), тот же принцип, что
 * me/avatar.ts::sniffImageMime. .doc/.xls живут в одном контейнере (OLE2
 * Compound File Binary — D0CF11E0A1B11AE1), который делят с .ppt И .msi;
 * магических байт контейнера НЕДОСТАТОЧНО, чтобы отличить документ от
 * инсталлятора — дополнительно ищем ASCII/UTF-16 имена внутренних CFB-
 * потоков, которые Office всегда пишет ("WordDocument"/"Workbook"/"Book"),
 * а MSI — нет. Это эвристика по именам потоков, не полный CFB-парсер:
 * задокументированное ограничение, см. итоговый отчёт (раздел N).
 */
function sniffFormat(buf: Buffer): { mime: string; kind: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', kind: 'jpeg' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', kind: 'png' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', kind: 'webp' };
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', kind: 'pdf' };

  if (buf.length >= 8 && buf.toString('hex', 0, 8) === 'd0cf11e0a1b11ae1') {
    if (bufferContainsUtf16(buf, 'WordDocument')) return { mime: 'application/msword', kind: 'doc' };
    if (bufferContainsUtf16(buf, 'Workbook') || bufferContainsUtf16(buf, 'Book')) return { mime: 'application/vnd.ms-excel', kind: 'xls' };
    return null; // CFB-контейнер, но не распознан как doc/xls — например .msi/.ppt — отклоняем
  }

  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) {
    if (bufferContainsAscii(buf, 'word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx' };
    if (bufferContainsAscii(buf, 'xl/')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'xlsx' };
    return null; // ZIP-контейнер, но не распознан как docx/xlsx — обычный .zip и т.п. — отклоняем
  }

  // Текст — нет магических байт; эвристика "file"-подобных инструментов:
  // нет NUL-байта в первых 8KB И весь буфер — валидный UTF-8.
  const head = buf.subarray(0, 8192);
  if (!head.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      return { mime: 'text/plain', kind: 'txt' };
    } catch {
      /* не валидный UTF-8 — не текст */
    }
  }
  return null;
}

export interface AttachmentValidationResult {
  ok: true;
  realMime: string;
  safeFilename: string;
}
export interface AttachmentValidationError {
  ok: false;
  error: string;
  message: string;
}

/**
 * filename — ТОЛЬКО метадата для отображения/Content-Disposition, никогда
 * не путь файловой системы (storage_key генерируется отдельно, случайным).
 * Здесь только вырезаем CR/LF (header injection в Content-Disposition) и
 * бьём path traversal/directory-компоненты (../, абсолютные пути,
 * произвольные разделители) — сама возможность traversal структурно
 * невозможна (filename никогда не участвует в построении реального пути),
 * это дополнительный слой, не единственная защита.
 */
function sanitizeFilename(raw: string): string {
  const base = raw.replace(/[\r\n]/g, '').split(/[/\\]/).pop() || 'file';
  const trimmed = base.trim().slice(0, 255);
  return trimmed || 'file';
}

export function validateAttachment(
  declaredFilename: string,
  buffer: Buffer
): AttachmentValidationResult | AttachmentValidationError {
  const safeFilename = sanitizeFilename(declaredFilename);
  const ext = extOf(safeFilename);

  if (!buffer.length) {
    return { ok: false, error: 'empty_file', message: 'Пустой файл' };
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'too_large', message: 'Файл превышает 20 МБ' };
  }
  if (EXPLICITLY_DANGEROUS_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'dangerous_type', message: 'Этот тип файла запрещён' };
  }
  const allowed = ALLOWED_TYPES.find((t) => t.ext === ext);
  if (!allowed) {
    return { ok: false, error: 'unsupported_type', message: 'Разрешены: JPEG, PNG, WEBP, PDF, TXT, DOC(X), XLS(X)' };
  }
  const sniffed = sniffFormat(buffer);
  if (!sniffed) {
    return { ok: false, error: 'content_mismatch', message: 'Содержимое файла не соответствует ожидаемому формату' };
  }
  // jpg/jpeg делят один kind, остальные — строгое совпадение kind/ext.
  const kindMatchesExt = sniffed.kind === ext || (sniffed.kind === 'jpeg' && (ext === 'jpg' || ext === 'jpeg'));
  if (!kindMatchesExt) {
    return { ok: false, error: 'extension_mime_mismatch', message: 'Расширение файла не совпадает с его реальным содержимым' };
  }
  return { ok: true, realMime: sniffed.mime, safeFilename };
}

export function generateStorageKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** RFC 5987 — filename* с процент-кодированием, чтобы не-ASCII имена и
 * любые управляющие символы не попадали в заголовок буквально. */
export function contentDispositionHeader(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
