/**
 * Регрессия 20.57.1 (production acceptance): чат-UI (композер/фид) был
 * виден внизу КАЖДОЙ страницы, а не только на "Чат", хотя switchPage()
 * (nav.ts) корректно управляет только классом .active. Причина —
 * CSS-специфичность: `.chat-page { display: flex }` была объявлена ПОСЛЕ
 * `.page { display: none }` в styles.css с той же специфичностью (0,1,0)
 * и поэтому побеждала независимо от .active. Фикс — `.chat-page.active`.
 *
 * Эти тесты грузят РЕАЛЬНЫЙ styles.css в jsdom и проверяют вычисленный
 * display через getComputedStyle — иначе регрессия чисто в CSS осталась
 * бы незамеченной тестами, проверяющими только classList.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function setupDom() {
  document.head.innerHTML = `<style>${stylesCss}</style>`;
  // Структура — упрощённое зеркало index.html: несколько .page + #page-chat
  // с реальной комбинацией классов ("page chat-page"), не изолированный фрагмент.
  document.body.innerHTML = `
    <div id="page-home" class="page active"></div>
    <div id="page-schedule" class="page"></div>
    <div id="page-profile" class="page"></div>
    <div id="page-chat" class="page chat-page">
      <div class="chat-composer">
        <textarea id="chatComposerInput"></textarea>
      </div>
    </div>
    <div class="nav-item" data-page="home"></div>
    <div class="nav-item" data-page="chat"></div>
  `;
}

async function freshNav() {
  const { vi } = await import('vitest');
  vi.resetModules();
  setupDom();
  for (const name of ['loadHome', 'loadChatPage', 'loadMonthSchedule']) {
    vi.stubGlobal(name, vi.fn());
  }
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  (window as any).page = 'home';
  return import('../src/app/nav.js');
}

describe('Чат — изоляция видимости UI по активной странице (регрессия 20.57.1)', () => {
  beforeEach(async () => {
    const { vi } = await import('vitest');
    vi.unstubAllGlobals();
  });

  it('A. старт на home — чат-UI полностью невидим (display: none)', async () => {
    setupDom();
    expect(getComputedStyle(document.getElementById('page-chat')!).display).toBe('none');
  });

  it('B. навигация home -> chat — чат отображается как полноценная страница (display: flex)', async () => {
    const { switchPage } = await freshNav();
    switchPage('chat');
    expect(getComputedStyle(document.getElementById('page-chat')!).display).toBe('flex');
    expect(document.getElementById('page-chat')!.classList.contains('active')).toBe(true);
  });

  it('C. навигация chat -> home — чат-UI снова полностью невидим', async () => {
    const { switchPage } = await freshNav();
    switchPage('chat');
    expect(getComputedStyle(document.getElementById('page-chat')!).display).toBe('flex');
    switchPage('home');
    expect(getComputedStyle(document.getElementById('page-chat')!).display).toBe('none');
    expect(document.getElementById('page-chat')!.classList.contains('active')).toBe(false);
  });

  it('D. навигация chat -> любая другая страница (schedule/profile) — чат-UI невидим', async () => {
    const { switchPage } = await freshNav();
    switchPage('chat');
    switchPage('schedule');
    expect(getComputedStyle(document.getElementById('page-chat')!).display).toBe('none');

    switchPage('chat');
    switchPage('profile');
    expect(getComputedStyle(document.getElementById('page-chat')!).display).toBe('none');
  });

  it('E. повторный вход/выход из чата — не плодит дублирующихся .active/обработчиков на других страницах', async () => {
    const { switchPage } = await freshNav();
    for (let i = 0; i < 3; i++) {
      switchPage('chat');
      switchPage('home');
    }
    // Ровно одна .page имеет .active в любой момент времени.
    expect(document.querySelectorAll('.page.active').length).toBe(1);
    expect(document.getElementById('page-home')!.classList.contains('active')).toBe(true);
    expect(getComputedStyle(document.getElementById('page-chat')!).display).toBe('none');
  });
});
