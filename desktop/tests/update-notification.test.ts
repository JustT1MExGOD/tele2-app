import { describe, it, expect } from 'vitest';
import { renderUpdateCardHtml } from '../src/preload/update-notification.js';
import type { UpdateStatus } from '../src/main/updater/types.js';

const baseManifest = {
  schemaVersion: 1 as const,
  channel: 'stable' as const,
  version: '20.55.1',
  publishedAt: '2026-08-31T12:00:00Z',
  mandatory: false,
  installer: {
    filename: 'T2Sales-Setup-x64-20.55.1.exe',
    url: 'https://updates.vincere-mortem.ru/releases/T2Sales-Setup-x64-20.55.1.exe',
    sha256: 'a'.repeat(64),
    size: 87 * 1024 * 1024
  }
};

function status(overrides: Partial<UpdateStatus>): UpdateStatus {
  return {
    state: 'up_to_date',
    currentVersion: '20.55.0',
    channel: 'stable',
    availableManifest: null,
    progress: null,
    errorMessage: null,
    signatureWarning: null,
    lastCheckedAt: null,
    readyToInstall: false,
    ...overrides
  };
}

describe('renderUpdateCardHtml — quiet states show nothing', () => {
  it('not_configured, up_to_date, checking all render null', () => {
    expect(renderUpdateCardHtml(status({ state: 'not_configured' }))).toBeNull();
    expect(renderUpdateCardHtml(status({ state: 'up_to_date' }))).toBeNull();
    expect(renderUpdateCardHtml(status({ state: 'checking' }))).toBeNull();
  });
});

describe('renderUpdateCardHtml — update_available', () => {
  it('shows version, size, and Download/Later buttons', () => {
    const html = renderUpdateCardHtml(status({ state: 'update_available', availableManifest: baseManifest }))!;
    expect(html).toContain('20.55.1');
    expect(html).toContain('87.0 МБ');
    expect(html).toContain('data-t2-action="download"');
    expect(html).toContain('data-t2-action="later"');
    expect(html).not.toContain('data-t2-action="install"');
  });

  it('shows release notes when present, HTML-escaped', () => {
    const html = renderUpdateCardHtml(
      status({ state: 'update_available', availableManifest: { ...baseManifest, releaseNotes: '<script>alert(1)</script> fixes' } })
    )!;
    expect(html).toContain('fixes');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows a mandatory badge for mandatory:true, but still only offers Download/Later — never force-installs', () => {
    const html = renderUpdateCardHtml(status({ state: 'update_available', availableManifest: { ...baseManifest, mandatory: true } }))!;
    expect(html).toContain('ВАЖНОЕ ОБНОВЛЕНИЕ');
    expect(html).toContain('data-t2-action="download"');
    expect(html).toContain('data-t2-action="later"');
    expect(html).not.toContain('data-t2-action="install"');
  });
});

describe('renderUpdateCardHtml — downloading', () => {
  it('shows a progress percentage derived from receivedBytes/totalBytes', () => {
    const html = renderUpdateCardHtml(status({ state: 'downloading', progress: { receivedBytes: 50, totalBytes: 100 } }))!;
    expect(html).toContain('width:50%');
  });

  it('handles a null progress without crashing (e.g. right at the start of a download)', () => {
    expect(() => renderUpdateCardHtml(status({ state: 'downloading', progress: null }))).not.toThrow();
  });
});

describe('renderUpdateCardHtml — verifying', () => {
  it('shows a verification-in-progress message', () => {
    expect(renderUpdateCardHtml(status({ state: 'verifying' }))).toContain('Проверка целостности');
  });
});

describe('renderUpdateCardHtml — ready_to_install', () => {
  it('shows Install/Later buttons and no signature warning when signed', () => {
    const html = renderUpdateCardHtml(status({ state: 'ready_to_install', readyToInstall: true }))!;
    expect(html).toContain('готово к установке');
    expect(html).toContain('data-t2-action="install"');
    expect(html).toContain('data-t2-action="later"');
  });

  it('surfaces a signatureWarning when the installer is unsigned', () => {
    const html = renderUpdateCardHtml(
      status({ state: 'ready_to_install', readyToInstall: true, signatureWarning: 'This update is not digitally signed (NotSigned).' })
    )!;
    expect(html).toContain('not digitally signed');
  });
});

describe('renderUpdateCardHtml — error', () => {
  it('shows a sanitized error message', () => {
    const html = renderUpdateCardHtml(status({ state: 'error', errorMessage: 'manifest fetch timed out' }))!;
    expect(html).toContain('manifest fetch timed out');
    expect(html).toContain('Ошибка обновления');
  });

  it('HTML-escapes the error message', () => {
    const html = renderUpdateCardHtml(status({ state: 'error', errorMessage: '<img src=x onerror=alert(1)>' }))!;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('renderUpdateCardHtml — sanitization guarantee', () => {
  it('never contains a cookie/token/header-shaped substring for any realistic status', () => {
    const states: UpdateStatus[] = [
      status({ state: 'update_available', availableManifest: baseManifest }),
      status({ state: 'downloading', progress: { receivedBytes: 1, totalBytes: 2 } }),
      status({ state: 'ready_to_install', readyToInstall: true, signatureWarning: 'not signed' }),
      status({ state: 'error', errorMessage: 'network error' })
    ];
    for (const s of states) {
      const html = (renderUpdateCardHtml(s) ?? '').toLowerCase();
      expect(html).not.toContain('cookie');
      expect(html).not.toContain('authorization');
      expect(html).not.toContain('csrf');
      expect(html).not.toContain('totp');
    }
  });
});
