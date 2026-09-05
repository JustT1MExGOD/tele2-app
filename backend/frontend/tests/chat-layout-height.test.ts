/**
 * 20.58 (visual-correction pass, §2/§17) — регрессия «чат выше вьюпорта».
 * .chat-page.active считало высоту как `100vh - --app-safe-top`, не
 * учитывая, что .app-header (не скрывается switchPage() ни для одной
 * страницы) реально рендерится над .chat-page. Дефолтный десктопный
 * оверрайд `.chat-page{height:calc(100vh-140px)}` был мёртвым кодом
 * (специфичность 0,1,0 не может перебить .chat-page.active 0,2,0) —
 * удалён. Реальная высота хедера теперь измеряется ResizeObserver'ом
 * (core.ts) и публикуется как --app-header-height на document.body.
 *
 * jsdom не умеет полноценно резолвить calc(var()), поэтому это в
 * основном статические проверки исходника styles.css плюс структурные
 * computed-style проверки того, что можно проверить в jsdom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function rule(selector: string): string {
  const idx = stylesCss.indexOf(selector);
  expect(idx, `selector "${selector}" not found in styles.css`).toBeGreaterThanOrEqual(0);
  const end = stylesCss.indexOf('}', idx);
  return stylesCss.slice(idx, end + 1);
}

describe('Чат — высота страницы учитывает реальный .app-header (20.58)', () => {
  it('.chat-page.active считает высоту через --app-header-height, не через --app-safe-top', () => {
    const css = rule('.chat-page.active {');
    expect(css).toContain('--app-header-height');
    expect(css).not.toContain('--app-safe-top');
  });

  it('.chat-page.active и .chat-scroll-box имеют min-height:0 (иначе flex-контейнер не сожмётся до вьюпорта)', () => {
    expect(rule('.chat-page.active {')).toMatch(/min-height:\s*0/);
    expect(rule('.chat-scroll-box {')).toMatch(/min-height:\s*0/);
  });

  it('.chat-page.active падает обратно на 100dvh, если поддерживается браузером', () => {
    const css = rule('.chat-page.active {');
    expect(css).toMatch(/height:\s*calc\(100vh/);
    expect(css).toMatch(/height:\s*calc\(100dvh/);
  });

  it('мёртвый десктопный оверрайд .chat-page{height:calc(100vh - 140px)} удалён', () => {
    expect(stylesCss).not.toMatch(/\.chat-page\s*\{\s*height:\s*calc\(100vh\s*-\s*140px\)/);
  });

  it('.chat-bubble не растягивается до избыточной ширины на широком десктопе', () => {
    expect(rule('.chat-bubble {')).toMatch(/max-width:\s*min\(78%,\s*640px\)/);
  });
});

// 20.58 Phase 2 (§8) — на мобильном .chat-page.active заполняло ровно весь
// вьюпорт (100dvh - header), не вычитая --bottom-nav-safe-offset. Fixed
// .bottom-nav (bottom:0, ~92px+safe-area) поэтому перекрывал .chat-composer
// — виден только если проскроллить документ вниз на величину
// body.padding-bottom, не то поведение, которого ждут от композера чата.
// На ≥860px .bottom-nav скрыт (display:none !important) — там вычитать
// нечего, высота возвращается к чистому header-only вычислению.
describe('Чат — .chat-page.active не уезжает под fixed .bottom-nav на мобильном (20.58 Phase 2)', () => {
  it('на базовом (мобильном) правиле высота дополнительно вычитает --bottom-nav-safe-offset', () => {
    const css = rule('.chat-page.active {');
    expect(css).toMatch(/height:\s*calc\(100vh\s*-\s*var\(--app-header-height,\s*0px\)\s*-\s*var\(--bottom-nav-safe-offset\)\)/);
    expect(css).toMatch(/height:\s*calc\(100dvh\s*-\s*var\(--app-header-height,\s*0px\)\s*-\s*var\(--bottom-nav-safe-offset\)\)/);
  });

  it('на ≥860px (bottom-nav скрыт) высота возвращается к вычету только хедера', () => {
    // Оверрайд для ≥860px намеренно объявлен ПОСЛЕ базового
    // .chat-page.active по тексту файла (иначе он оказался бы раньше в
    // каскаде) — ищем следующий @media (min-width: 860px) после
    // базового правила, не первое вхождение в файле (которое относится
    // к основному desktop-shell блоку, а не к чату).
    const baseIdx = stylesCss.indexOf('.chat-page.active {');
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    const desktopIdx = stylesCss.indexOf('@media (min-width: 860px)', baseIdx);
    expect(desktopIdx).toBeGreaterThanOrEqual(0);
    const afterDesktop = stylesCss.slice(desktopIdx);
    const idx = afterDesktop.indexOf('.chat-page.active {');
    expect(idx, '.chat-page.active override not found inside the ≥860px media block').toBeGreaterThanOrEqual(0);
    const end = afterDesktop.indexOf('}', idx);
    const css = afterDesktop.slice(idx, end + 1);
    expect(css).toMatch(/height:\s*calc\(100vh\s*-\s*var\(--app-header-height,\s*0px\)\)/);
    expect(css).toMatch(/height:\s*calc\(100dvh\s*-\s*var\(--app-header-height,\s*0px\)\)/);
    expect(css).not.toContain('--bottom-nav-safe-offset');
  });
});
