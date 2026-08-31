import { describe, it, expect } from 'vitest';
import { validateManifest, ManifestValidationError } from '../src/main/updater/manifest.js';

const ORIGIN = 'https://updates.vincere-mortem.ru';

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    channel: 'stable',
    version: '20.55.1',
    publishedAt: '2026-08-31T12:00:00Z',
    mandatory: false,
    installer: {
      filename: 'T2Sales-Setup-x64-20.55.1.exe',
      url: `${ORIGIN}/releases/T2Sales-Setup-x64-20.55.1.exe`,
      sha256: 'a'.repeat(64),
      size: 123456789
    },
    ...overrides
  };
}

describe('validateManifest — valid input', () => {
  it('accepts a well-formed manifest', () => {
    const m = validateManifest(validManifest(), 'stable', ORIGIN);
    expect(m.version).toBe('20.55.1');
    expect(m.installer.sha256).toBe('a'.repeat(64));
  });
  it('lowercases sha256', () => {
    const m = validateManifest(validManifest({ installer: { ...validManifest().installer, sha256: 'A'.repeat(64) } }), 'stable', ORIGIN);
    expect(m.installer.sha256).toBe('a'.repeat(64));
  });
  it('accepts optional releaseNotes and minSupportedVersion', () => {
    const m = validateManifest(validManifest({ releaseNotes: 'Bug fixes', minSupportedVersion: '20.50.0' }), 'stable', ORIGIN);
    expect(m.releaseNotes).toBe('Bug fixes');
    expect(m.minSupportedVersion).toBe('20.50.0');
  });
  it('accepts the beta channel when expected', () => {
    const m = validateManifest(validManifest({ channel: 'beta' }), 'beta', ORIGIN);
    expect(m.channel).toBe('beta');
  });
});

describe('validateManifest — invalid schema', () => {
  it('rejects non-object input', () => {
    expect(() => validateManifest(null, 'stable', ORIGIN)).toThrow(ManifestValidationError);
    expect(() => validateManifest('a string', 'stable', ORIGIN)).toThrow(ManifestValidationError);
    expect(() => validateManifest([1, 2, 3], 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects an unsupported schemaVersion', () => {
    expect(() => validateManifest(validManifest({ schemaVersion: 2 }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects an unrecognized channel', () => {
    expect(() => validateManifest(validManifest({ channel: 'nightly' }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a manifest whose channel does not match the channel it was fetched for', () => {
    expect(() => validateManifest(validManifest({ channel: 'beta' }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a missing/malformed mandatory flag', () => {
    expect(() => validateManifest(validManifest({ mandatory: 'false' }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a malformed publishedAt', () => {
    expect(() => validateManifest(validManifest({ publishedAt: 'not-a-date' }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('never accepts an executable command/arguments field even if present — the schema has no such slot', () => {
    const withCommand = { ...validManifest(), command: 'evil.exe', args: ['/S'] };
    const m = validateManifest(withCommand, 'stable', ORIGIN);
    expect((m as unknown as Record<string, unknown>).command).toBeUndefined();
    expect((m as unknown as Record<string, unknown>).args).toBeUndefined();
  });
});

describe('validateManifest — bad version', () => {
  it('rejects a non-parseable version', () => {
    expect(() => validateManifest(validManifest({ version: 'v20.55.1' }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a malformed minSupportedVersion', () => {
    expect(() => validateManifest(validManifest({ minSupportedVersion: 'garbage' }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
});

describe('validateManifest — bad sha256', () => {
  it('rejects a too-short hash', () => {
    const m = validManifest();
    m.installer = { ...m.installer, sha256: 'abc123' };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a non-hex hash', () => {
    const m = validManifest();
    m.installer = { ...m.installer, sha256: 'g'.repeat(64) };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
});

describe('validateManifest — bad size', () => {
  it('rejects zero/negative size', () => {
    const m = validManifest();
    m.installer = { ...m.installer, size: 0 };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a size exceeding the hard cap', () => {
    const m = validManifest();
    m.installer = { ...m.installer, size: 1024 * 1024 * 1024 * 1024 };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a non-integer size', () => {
    const m = validManifest();
    m.installer = { ...m.installer, size: 123.456 };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
});

describe('validateManifest — installer.url origin/scheme enforcement', () => {
  it('rejects an http:// URL in production', () => {
    const m = validManifest();
    m.installer = { ...m.installer, url: `http://updates.vincere-mortem.ru/releases/${m.installer.filename}` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a URL on the wrong hostname', () => {
    const m = validManifest();
    m.installer = { ...m.installer, url: `https://attacker.example/releases/${m.installer.filename}` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a URL on a look-alike hostname (subdomain confusion)', () => {
    const m = validManifest();
    m.installer = { ...m.installer, url: `https://updates.vincere-mortem.ru.attacker.example/releases/${m.installer.filename}` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a URL outside /releases/', () => {
    const m = validManifest();
    m.installer = { ...m.installer, url: `${ORIGIN}/stable/${m.installer.filename}` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a URL whose filename does not match installer.filename', () => {
    const m = validManifest();
    m.installer = { ...m.installer, url: `${ORIGIN}/releases/different-file.exe` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a malformed URL string', () => {
    const m = validManifest();
    m.installer = { ...m.installer, url: 'not a url' };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
});

describe('validateManifest — installer.filename safety (path traversal / arbitrary paths)', () => {
  it('rejects a filename with a path separator', () => {
    const m = validManifest();
    m.installer = { ...m.installer, filename: '../evil.exe', url: `${ORIGIN}/releases/..%2Fevil.exe` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a filename that is not .exe', () => {
    const m = validManifest();
    m.installer = { ...m.installer, filename: 'evil.sh', url: `${ORIGIN}/releases/evil.sh` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
  it('rejects a filename with backslashes', () => {
    const m = validManifest();
    m.installer = { ...m.installer, filename: 'sub\\evil.exe', url: `${ORIGIN}/releases/sub%5Cevil.exe` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });

  // Security gate §2 — Windows reserves these device names for the
  // portion of the filename before the first dot, case-insensitively,
  // regardless of extension. A manifest naming one would produce a
  // filename the OS itself can't create/open normally.
  it.each(['CON.exe', 'con.exe', 'PRN.exe', 'AUX.exe', 'NUL.exe', 'COM1.exe', 'LPT1.exe', 'Com3.exe'])(
    'rejects the Windows-reserved device name "%s"',
    (filename) => {
      const m = validManifest();
      m.installer = { ...m.installer, filename, url: `${ORIGIN}/releases/${filename}` };
      expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
    }
  );

  it('a reserved name is still rejected when followed by extra dotted segments (Windows reserves the part before the FIRST dot)', () => {
    const m = validManifest();
    const filename = 'CON.v2.exe';
    m.installer = { ...m.installer, filename, url: `${ORIGIN}/releases/${filename}` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });

  it('does NOT reject an ordinary filename that merely starts with reserved-name letters', () => {
    const m = validManifest();
    const filename = 'CONtoso-Setup-x64-20.55.1.exe'; // "CON..." prefix but not the reserved name itself
    m.installer = { ...m.installer, filename, url: `${ORIGIN}/releases/${filename}` };
    expect(() => validateManifest(m, 'stable', ORIGIN)).not.toThrow();
  });
});

describe('validateManifest — bounded releaseNotes', () => {
  it('rejects releaseNotes exceeding the length cap', () => {
    expect(() => validateManifest(validManifest({ releaseNotes: 'x'.repeat(20000) }), 'stable', ORIGIN)).toThrow(ManifestValidationError);
  });
});
