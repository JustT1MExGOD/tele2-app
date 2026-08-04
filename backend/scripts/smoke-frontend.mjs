#!/usr/bin/env node
/**
 * Smoke-тест порядка подключения frontend/js/*.js.
 *
 * Не браузер и не полноценный DOM — просто честная общая global-область,
 * как у классических <script> тегов, с минимальными заглушками. Цель узкая:
 * поймать ситуацию, когда файл использует на верхнем уровне (или в коде,
 * который выполняется сразу при загрузке — например bootApp() в самом низу
 * файла) что-то, что определено в файле, подключаемом позже. Именно так
 * сломался 14.3.0 — todayMoscow() дергалась в 01-core.js, а жила в
 * 02-nav-utils.js, которая подключается следующей.
 *
 * Запуск: node scripts/smoke-frontend.mjs   (или npm run smoke:frontend)
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const INDEX_HTML = path.join(FRONTEND_DIR, 'index.html');

function extractScriptOrder(html) {
  const srcs = [];
  const re = /<script\s+src="([^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html))) srcs.push(m[1]);
  // только локальные — внешний telegram-web-app.js не наш код
  return srcs.filter((s) => !/^https?:\/\//.test(s));
}

function makeFakeElement(id) {
  const store = { id };
  const classList = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'add' || prop === 'remove' || prop === 'toggle') return () => {};
        if (prop === 'contains') return () => false;
        return undefined;
      }
    }
  );
  const style = new Proxy({}, { get: (t, p) => t[p] ?? '', set: (t, p, v) => ((t[p] = v), true) });
  const dataset = {};
  const noop = () => {};
  const chain = () => fakeEl;
  const fakeEl = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'classList') return classList;
      if (prop === 'style') return style;
      if (prop === 'dataset') return dataset;
      if (prop === 'querySelector') return () => null;
      if (prop === 'querySelectorAll') return () => [];
      if (
        [
          'addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'remove',
          'focus', 'blur', 'click', 'scrollIntoView', 'dispatchEvent', 'setAttribute'
        ].includes(prop)
      ) return noop;
      if (prop === 'getAttribute') return () => null;
      if (prop === 'closest') return chain;
      if (typeof prop === 'symbol') return undefined;
      return undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
  return fakeEl;
}

function buildSandbox() {
  const elCache = new Map();
  const document = {
    getElementById(id) {
      if (!elCache.has(id)) elCache.set(id, makeFakeElement(id));
      return elCache.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeFakeElement('created'),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: makeFakeElement('body')
  };

  const localStorageMap = new Map();
  const localStorage = {
    getItem: (k) => (localStorageMap.has(k) ? localStorageMap.get(k) : null),
    setItem: (k, v) => localStorageMap.set(k, String(v)),
    removeItem: (k) => localStorageMap.delete(k)
  };

  async function fetchStub() {
    return {
      ok: false,
      status: 0,
      json: async () => [],
      text: async () => ''
    };
  }

  const sandbox = {
    document,
    localStorage,
    navigator: {
      onLine: false, // держим офлайн-ветки тихими — это не тест офлайн-очереди
      geolocation: { getCurrentPosition: (_ok, err) => err && err(new Error('no geo in smoke test')) }
    },
    fetch: fetchStub,
    crypto: { randomUUID: () => 'smoke-' + Math.random().toString(36).slice(2) },
    Telegram: {
      WebApp: {
        initData: '',
        initDataUnsafe: {},
        ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
        HapticFeedback: { notificationOccurred() {}, impactOccurred() {} },
        onEvent() {}, offEvent() {}
      }
    },
    location: { origin: 'https://smoke-test.local', hash: '' },
    addEventListener: () => {},
    removeEventListener: () => {},
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, Intl, Date, Math, JSON, Array, Object, String, Number, Boolean,
    Promise, Map, Set, RegExp, Error, TypeError, RangeError,
    localStorage_unused: undefined
  };
  sandbox.window = sandbox;
  delete sandbox.localStorage_unused;
  return sandbox;
}

async function main() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const scripts = extractScriptOrder(html);
  if (!scripts.length) {
    console.error('Не нашёл ни одного <script src="..."> в index.html — проверь регэксп/разметку.');
    process.exit(2);
  }

  const sandbox = buildSandbox();
  const context = vm.createContext(sandbox);

  const failures = [];
  const rejections = [];
  process.on('unhandledRejection', (reason) => {
    rejections.push(reason?.stack || String(reason));
  });

  for (const src of scripts) {
    const rel = src.replace(/^\//, '');
    const file = path.join(FRONTEND_DIR, rel);
    if (!fs.existsSync(file)) {
      failures.push({ file: src, error: 'файл не найден на диске (404 в проде тоже был бы)' });
      continue;
    }
    const code = fs.readFileSync(file, 'utf8');
    try {
      vm.runInContext(code, context, { filename: src, displayErrors: true });
    } catch (e) {
      failures.push({ file: src, error: e.stack || e.message });
    }
  }

  // дать шанс синхронно-брошенным исключениям из немедленно вызванных
  // async-функций (например bootApp()) всплыть как unhandledRejection
  await new Promise((r) => setTimeout(r, 300));

  console.log(`Проверено файлов: ${scripts.length}`);

  if (!failures.length && !rejections.length) {
    console.log('OK — ни один файл не упал при загрузке в порядке из index.html.');
    process.exit(0);
  }

  if (failures.length) {
    console.error(`\n${failures.length} файл(ов) упали при загрузке:\n`);
    for (const f of failures) console.error(`  ${f.file}\n    ${f.error}\n`);
  }
  if (rejections.length) {
    console.error(`${rejections.length} необработанных исключений в коде, вызванном сразу при загрузке:\n`);
    for (const r of rejections) console.error(`  ${r}\n`);
  }
  process.exit(1);
}

main();
