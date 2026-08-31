/**
 * UpdateManager orchestration tests — mocks the underlying network/
 * filesystem modules (fetch-manifest/downloader/signature/install-
 * launcher already have their own real-transport tests) to focus on the
 * state machine, scheduling, and security-boundary behavior itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    channel: 'stable',
    version: '20.99.0',
    publishedAt: new Date().toISOString(),
    mandatory: false,
    installer: {
      filename: 'T2Sales-Setup-x64-20.99.0.exe',
      url: 'https://updates.vincere-mortem.ru/releases/T2Sales-Setup-x64-20.99.0.exe',
      sha256: 'a'.repeat(64),
      size: 12345
    },
    ...overrides
  };
}

async function freshManager(overrides: Record<string, unknown> = {}, mocks: Record<string, unknown> = {}) {
  vi.doMock('../src/main/updater/fetch-manifest.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/main/updater/fetch-manifest.js')>();
    return { ...actual, fetchManifest: vi.fn().mockResolvedValue(baseManifest()), ...mocks };
  });
  vi.doMock('../src/main/updater/downloader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/main/updater/downloader.js')>();
    return {
      ...actual,
      downloadAndVerifyInstaller: vi.fn().mockResolvedValue({ filePath: 'C:\\fake\\T2Sales-Setup-x64-20.99.0.exe' }),
      // TOCTOU re-check (installUpdate() calls this again immediately
      // before launch) — defaults to "still matches", same as a real
      // untampered file would; tests that exercise the TOCTOU path
      // override this explicitly via `mocks`.
      verifyFileIntegrity: vi.fn().mockResolvedValue(undefined),
      ...mocks
    };
  });
  vi.doMock('../src/main/updater/signature.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/main/updater/signature.js')>();
    return {
      ...actual,
      verifyAuthenticodeSignature: vi.fn().mockResolvedValue({ status: 'NotSigned', signed: false, subject: null }),
      ...mocks
    };
  });
  vi.doMock('../src/main/updater/install-launcher.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/main/updater/install-launcher.js')>();
    return { ...actual, launchInstaller: vi.fn().mockResolvedValue(undefined), ...mocks };
  });
  vi.resetModules();
  const { UpdateManager } = await import('../src/main/updater/manager.js');
  return new UpdateManager({
    updateBaseUrl: 'https://updates.vincere-mortem.ru',
    channel: 'stable',
    currentVersion: '20.55.0',
    updateCacheDir: 'C:\\fake\\updates',
    ...overrides
  });
}

describe('UpdateManager — not_configured (§1/§14: dev/test isolation)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never schedules any timer and stays not_configured when updateBaseUrl is empty', async () => {
    vi.doMock('../src/main/updater/fetch-manifest.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/main/updater/fetch-manifest.js')>();
      return { ...actual, fetchManifest: vi.fn() };
    });
    vi.resetModules();
    const { UpdateManager } = await import('../src/main/updater/manager.js');
    const setTimeoutFn = vi.fn();
    const setIntervalFn = vi.fn();
    const manager = new UpdateManager({
      updateBaseUrl: '',
      channel: 'stable',
      currentVersion: '20.55.0',
      updateCacheDir: 'C:\\fake\\updates',
      setTimeout: setTimeoutFn,
      setInterval: setIntervalFn
    });
    manager.start();
    expect(manager.getStatus().state).toBe('not_configured');
    expect(setTimeoutFn).not.toHaveBeenCalled();
    expect(setIntervalFn).not.toHaveBeenCalled();
  });

  it('checkNow() is a no-op (does not throw, does not change state) when not configured', async () => {
    const manager = await freshManager({ updateBaseUrl: '' });
    await manager.checkNow();
    expect(manager.getStatus().state).toBe('not_configured');
  });
});

describe('UpdateManager — checkNow() version comparison outcomes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('newer manifest version -> update_available, exposes the manifest', async () => {
    const manager = await freshManager({ currentVersion: '20.55.0' }); // mocked manifest is 20.99.0
    await manager.checkNow();
    const status = manager.getStatus();
    expect(status.state).toBe('update_available');
    expect(status.availableManifest?.version).toBe('20.99.0');
    expect(status.lastCheckedAt).not.toBeNull();
  });

  it('same manifest version -> up_to_date, no manifest exposed', async () => {
    const manager = await freshManager({ currentVersion: '20.99.0' });
    await manager.checkNow();
    const status = manager.getStatus();
    expect(status.state).toBe('up_to_date');
    expect(status.availableManifest).toBeNull();
  });

  it('older manifest version (server rolled back / stale) -> up_to_date, never treated as available', async () => {
    const manager = await freshManager({ currentVersion: '21.0.0' }); // ahead of the mocked 20.99.0
    await manager.checkNow();
    expect(manager.getStatus().state).toBe('up_to_date');
  });

  it('a manifest fetch failure lands in state error with a sanitized message, never throws out of checkNow()', async () => {
    const manager = await freshManager({}, { fetchManifest: vi.fn().mockRejectedValue(new Error('DNS lookup failed for updates.vincere-mortem.ru')) });
    await expect(manager.checkNow()).resolves.not.toThrow();
    const status = manager.getStatus();
    expect(status.state).toBe('error');
    expect(status.errorMessage).toBeTruthy();
  });
});

describe('UpdateManager — download + signature policy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('an unsigned installer under the default "warn" policy still reaches ready_to_install, with a signatureWarning set', async () => {
    const manager = await freshManager({ currentVersion: '20.55.0' });
    await manager.checkNow();
    await manager.downloadUpdate();
    const status = manager.getStatus();
    expect(status.state).toBe('ready_to_install');
    expect(status.readyToInstall).toBe(true);
    expect(status.signatureWarning).toContain('не имеет цифровой подписи');
  });

  it('a signed installer reaches ready_to_install with no signatureWarning', async () => {
    const manager = await freshManager(
      { currentVersion: '20.55.0' },
      { verifyAuthenticodeSignature: vi.fn().mockResolvedValue({ status: 'Valid', signed: true, subject: 'CN=T2 Sales' }) }
    );
    await manager.checkNow();
    await manager.downloadUpdate();
    const status = manager.getStatus();
    expect(status.state).toBe('ready_to_install');
    expect(status.signatureWarning).toBeNull();
  });

  it('a download failure lands in state error and readyToInstall stays false', async () => {
    const manager = await freshManager(
      { currentVersion: '20.55.0' },
      { downloadAndVerifyInstaller: vi.fn().mockRejectedValue(new Error('SHA-256 mismatch')) }
    );
    await manager.checkNow();
    await manager.downloadUpdate();
    const status = manager.getStatus();
    expect(status.state).toBe('error');
    expect(status.readyToInstall).toBe(false);
  });

  it('downloadUpdate() is a no-op with no available manifest', async () => {
    const manager = await freshManager({ currentVersion: '99.0.0' }); // already newer than mocked manifest
    await manager.checkNow(); // -> up_to_date, no manifest
    await manager.downloadUpdate();
    expect(manager.getStatus().state).toBe('up_to_date'); // unchanged, never entered downloading
  });
});

describe('UpdateManager — installUpdate() (§8/§9 security boundary)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses to install when not in the ready_to_install state', async () => {
    const manager = await freshManager();
    await expect(manager.installUpdate()).rejects.toThrow(/no verified update is ready/);
  });

  it('installUpdate() always launches the exact path this manager itself downloaded+verified — its only parameter is a void callback with no way to redirect what launches', async () => {
    const launchInstallerMock = vi.fn().mockResolvedValue(undefined);
    const manager = await freshManager({ currentVersion: '20.55.0' }, { launchInstaller: launchInstallerMock });
    await manager.checkNow();
    await manager.downloadUpdate();
    expect(manager.getStatus().state).toBe('ready_to_install');

    await manager.installUpdate();
    expect(launchInstallerMock).toHaveBeenCalledTimes(1);
    expect(launchInstallerMock).toHaveBeenCalledWith('C:\\fake\\T2Sales-Setup-x64-20.99.0.exe'); // exactly the mocked downloader's own result — nothing else could have supplied this
  });

  it('calls the onLaunched callback after successfully launching', async () => {
    const manager = await freshManager({ currentVersion: '20.55.0' });
    await manager.checkNow();
    await manager.downloadUpdate();
    const onLaunched = vi.fn();
    await manager.installUpdate(onLaunched);
    expect(onLaunched).toHaveBeenCalledOnce();
  });
});

describe('UpdateManager — installUpdate() TOCTOU re-verification (security gate §1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('re-verifies file integrity immediately before launch, and refuses to launch + lands in error if it fails (file swapped during ready_to_install)', async () => {
    const launchInstallerMock = vi.fn().mockResolvedValue(undefined);
    const verifyFileIntegrityMock = vi.fn().mockResolvedValue(undefined);
    const manager = await freshManager(
      { currentVersion: '20.55.0' },
      { launchInstaller: launchInstallerMock, verifyFileIntegrity: verifyFileIntegrityMock }
    );
    await manager.checkNow();
    await manager.downloadUpdate();
    expect(manager.getStatus().state).toBe('ready_to_install');

    // Simulate the file being swapped during the waiting window — the
    // SECOND verifyFileIntegrity call (the one installUpdate() makes)
    // now fails, even though downloadUpdate()'s own call succeeded.
    // DownloadError must come from the SAME (post-vi.resetModules) module
    // graph freshManager() just built — a DownloadError imported at this
    // test file's top level would be a different class instance (a
    // separate module evaluation), which would fail manager.ts's own
    // `instanceof DownloadError` check in sanitizeError().
    const { DownloadError } = await import('../src/main/updater/downloader.js');
    verifyFileIntegrityMock.mockRejectedValueOnce(new DownloadError('installer SHA-256 changed since verification'));

    await expect(manager.installUpdate()).rejects.toThrow(/SHA-256 changed/);
    expect(launchInstallerMock).not.toHaveBeenCalled();
    const status = manager.getStatus();
    expect(status.state).toBe('error');
    expect(status.readyToInstall).toBe(false);
  });

  it('re-verifies Authenticode policy immediately before launch, and refuses to launch a file whose signature is now broken', async () => {
    const launchInstallerMock = vi.fn().mockResolvedValue(undefined);
    // Valid at download time, HashMismatch (tampered) at install time —
    // mockResolvedValueOnce for the first (download-time) call, the
    // persistent mock covers every subsequent call including
    // installUpdate()'s re-check.
    const verifyAuthenticodeSignatureMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 'Valid', signed: true, subject: 'CN=T2 Sales' })
      .mockResolvedValue({ status: 'HashMismatch', signed: false, subject: null });
    const manager = await freshManager(
      { currentVersion: '20.55.0' },
      { launchInstaller: launchInstallerMock, verifyAuthenticodeSignature: verifyAuthenticodeSignatureMock }
    );
    await manager.checkNow();
    await manager.downloadUpdate();
    expect(manager.getStatus().state).toBe('ready_to_install');

    await expect(manager.installUpdate()).rejects.toThrow(/подпись повреждена или недействительна/);
    expect(launchInstallerMock).not.toHaveBeenCalled();
    expect(manager.getStatus().state).toBe('error');
  });

  it('a duplicate installUpdate() call while a launch is already in flight is a no-op — the installer is never launched twice', async () => {
    let resolveLaunch: () => void = () => {};
    const launchInstallerMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLaunch = resolve;
        })
    );
    const manager = await freshManager({ currentVersion: '20.55.0' }, { launchInstaller: launchInstallerMock });
    await manager.checkNow();
    await manager.downloadUpdate();

    const first = manager.installUpdate();
    const second = manager.installUpdate(); // races the first, before it resolves
    await vi.waitFor(() => expect(launchInstallerMock).toHaveBeenCalled());
    resolveLaunch();
    await Promise.all([first, second]);

    expect(launchInstallerMock).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateManager — concurrency guards (security gate §3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a second checkNow() call while one is already in flight does not start a duplicate fetch', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchManifestMock = vi.fn(() => new Promise((resolve) => (resolveFetch = resolve)));
    const manager = await freshManager({ currentVersion: '20.55.0' }, { fetchManifest: fetchManifestMock });

    const first = manager.checkNow();
    const second = manager.checkNow(); // fires while state is already 'checking'
    resolveFetch(baseManifest());
    await Promise.all([first, second]);

    expect(fetchManifestMock).toHaveBeenCalledTimes(1);
  });

  it('checkNow() is a no-op while a download is actively in progress — does not hijack the visible downloading/verifying state', async () => {
    let resolveDownload: (v: unknown) => void = () => {};
    const downloadAndVerifyInstallerMock = vi.fn(() => new Promise((resolve) => (resolveDownload = resolve)));
    const manager = await freshManager(
      { currentVersion: '20.55.0' },
      { downloadAndVerifyInstaller: downloadAndVerifyInstallerMock }
    );
    await manager.checkNow();
    const downloadPromise = manager.downloadUpdate();
    expect(manager.getStatus().state).toBe('downloading');

    await manager.checkNow(); // must be a no-op — state stays 'downloading'
    expect(manager.getStatus().state).toBe('downloading');

    resolveDownload({ filePath: 'C:\\fake\\T2Sales-Setup-x64-20.99.0.exe' });
    await downloadPromise;
  });

  it('a second downloadUpdate() call while one is already downloading does not start a parallel transfer', async () => {
    let resolveDownload: (v: unknown) => void = () => {};
    const downloadAndVerifyInstallerMock = vi.fn(() => new Promise((resolve) => (resolveDownload = resolve)));
    const manager = await freshManager(
      { currentVersion: '20.55.0' },
      { downloadAndVerifyInstaller: downloadAndVerifyInstallerMock }
    );
    await manager.checkNow();
    const first = manager.downloadUpdate();
    const second = manager.downloadUpdate(); // races the first
    resolveDownload({ filePath: 'C:\\fake\\T2Sales-Setup-x64-20.99.0.exe' });
    await Promise.all([first, second]);

    expect(downloadAndVerifyInstallerMock).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateManager — scheduling (§4: not aggressive polling)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('start() schedules exactly one initial delayed check and one recurring interval, both unref-able, when configured', async () => {
    vi.doMock('../src/main/updater/fetch-manifest.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/main/updater/fetch-manifest.js')>();
      return { ...actual, fetchManifest: vi.fn().mockResolvedValue(baseManifest()) };
    });
    vi.resetModules();
    const { UpdateManager } = await import('../src/main/updater/manager.js');
    const setTimeoutFn = vi.fn().mockReturnValue({ unref: vi.fn() });
    const setIntervalFn = vi.fn().mockReturnValue({ unref: vi.fn() });
    const manager = new UpdateManager({
      updateBaseUrl: 'https://updates.vincere-mortem.ru',
      channel: 'stable',
      currentVersion: '20.55.0',
      updateCacheDir: 'C:\\fake\\updates',
      setTimeout: setTimeoutFn,
      setInterval: setIntervalFn
    });
    manager.start();
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    // The interval delay is measured in hours, not minutes/seconds —
    // proves this isn't aggressive polling.
    const intervalMs = setIntervalFn.mock.calls[0][1] as number;
    expect(intervalMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it('calling start() twice does not leak timers (security gate §8: idempotent re-init) — the first pair is cleared before the second is scheduled', async () => {
    vi.doMock('../src/main/updater/fetch-manifest.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/main/updater/fetch-manifest.js')>();
      return { ...actual, fetchManifest: vi.fn().mockResolvedValue(baseManifest()) };
    });
    vi.resetModules();
    const { UpdateManager } = await import('../src/main/updater/manager.js');
    const clearTimeoutFn = vi.fn();
    const clearIntervalFn = vi.fn();
    const setTimeoutFn = vi.fn().mockReturnValue({ unref: vi.fn() });
    const setIntervalFn = vi.fn().mockReturnValue({ unref: vi.fn() });
    const manager = new UpdateManager({
      updateBaseUrl: 'https://updates.vincere-mortem.ru',
      channel: 'stable',
      currentVersion: '20.55.0',
      updateCacheDir: 'C:\\fake\\updates',
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn
    });
    manager.start();
    manager.start();
    expect(setTimeoutFn).toHaveBeenCalledTimes(2);
    expect(setIntervalFn).toHaveBeenCalledTimes(2);
    // The first call's timers must have been cleared before the second
    // pair was scheduled — otherwise the first pair is leaked/orphaned.
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });
});
