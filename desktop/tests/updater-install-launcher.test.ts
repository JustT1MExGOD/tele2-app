import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const openPathMock = vi.fn();

vi.mock('electron', () => ({
  shell: { openPath: (...args: unknown[]) => openPathMock(...args) }
}));
vi.mock('node:fs', () => ({
  default: { stat: vi.fn() },
  stat: vi.fn()
}));

describe('launchInstaller — path validation', () => {
  beforeEach(() => openPathMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('rejects a relative path', async () => {
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('relative\\path.exe')).rejects.toThrow(InstallLaunchError);
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it('rejects a non-.exe extension', async () => {
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('C:\\fake\\script.bat')).rejects.toThrow(InstallLaunchError);
  });

  it('rejects a filename that does not match the exact T2Sales-Setup-x64-<version>.exe shape (tightened beyond manifest.ts\'s generic *.exe check)', async () => {
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('C:\\fake\\SomeOtherApp-20.56.4.exe')).rejects.toThrow(InstallLaunchError);
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it('rejects a filename containing shell metacharacters — fail-closed BEFORE shell.openPath is ever called', async () => {
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('C:\\fake\\T2Sales-Setup-x64-20.56.4.exe & calc &.exe')).rejects.toThrow(InstallLaunchError);
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it('rejects when the file does not exist on disk', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(new Error('ENOENT')));
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('C:\\fake\\T2Sales-Setup-x64-20.56.4.exe')).rejects.toThrow(InstallLaunchError);
    expect(openPathMock).not.toHaveBeenCalled();
  });
});

describe('launchInstaller — launch mechanics (§updater-install-lifecycle: shell.openPath, no command line/shell boundary at all)', () => {
  beforeEach(() => openPathMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('launches via shell.openPath() with the literal path — no arguments, no command line built at all', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(null, { isFile: () => true }));
    openPathMock.mockResolvedValue(''); // Electron's own success signal
    const { launchInstaller } = await import('../src/main/updater/install-launcher.js');
    await launchInstaller('C:\\fake\\T2Sales-Setup-x64-20.56.4.exe');
    expect(openPathMock).toHaveBeenCalledExactlyOnceWith('C:\\fake\\T2Sales-Setup-x64-20.56.4.exe');
  });

  it('resolves once shell.openPath() confirms success (empty string) — a real, structured confirmation, not merely "openPath() was called"', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(null, { isFile: () => true }));
    let openPathResolved = false;
    openPathMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            openPathResolved = true;
            resolve('');
          }, 5);
        })
    );
    const { launchInstaller } = await import('../src/main/updater/install-launcher.js');
    await launchInstaller('C:\\fake\\T2Sales-Setup-x64-20.56.4.exe');
    expect(openPathResolved).toBe(true);
  });

  it('rejects with InstallLaunchError when shell.openPath() resolves with a non-empty error string (Electron\'s own documented failure signal)', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(null, { isFile: () => true }));
    openPathMock.mockResolvedValue('The system cannot find the file specified.');
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('C:\\fake\\T2Sales-Setup-x64-20.56.4.exe')).rejects.toThrow(InstallLaunchError);
  });

  it('a path with a space is passed through verbatim, unmodified — matches the real %LOCALAPPDATA%\\T2 Sales\\updates\\ layout', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(null, { isFile: () => true }));
    openPathMock.mockResolvedValue('');
    const { launchInstaller } = await import('../src/main/updater/install-launcher.js');
    const spacedPath = 'C:\\Users\\fake\\AppData\\Local\\T2 Sales\\updates\\T2Sales-Setup-x64-20.56.4.exe';
    await launchInstaller(spacedPath);
    expect(openPathMock).toHaveBeenCalledExactlyOnceWith(spacedPath);
  });
});
