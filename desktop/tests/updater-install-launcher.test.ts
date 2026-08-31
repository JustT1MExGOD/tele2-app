import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}));
vi.mock('node:fs', () => ({
  default: { stat: vi.fn() },
  stat: vi.fn()
}));

describe('launchInstaller — path validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects a relative path', async () => {
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('relative\\path.exe')).rejects.toThrow(InstallLaunchError);
  });

  it('rejects a non-.exe extension', async () => {
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('C:\\fake\\script.bat')).rejects.toThrow(InstallLaunchError);
  });

  it('rejects when the file does not exist on disk', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(new Error('ENOENT')));
    const { launchInstaller, InstallLaunchError } = await import('../src/main/updater/install-launcher.js');
    await expect(launchInstaller('C:\\fake\\missing.exe')).rejects.toThrow(InstallLaunchError);
  });
});

describe('launchInstaller — launch mechanics (execFile, no shell, no arguments)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('launches via execFile with NO arguments — no /S, no silent flags', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(null, { isFile: () => true }));
    const { execFile } = await import('node:child_process');
    let capturedPath = '';
    let capturedArgs: unknown;
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd, args, _opts, cb) => {
      capturedPath = cmd as string;
      capturedArgs = args;
      cb(null, '', '');
      return { unref: vi.fn() };
    });
    const { launchInstaller } = await import('../src/main/updater/install-launcher.js');
    await launchInstaller('C:\\fake\\T2Sales-Setup-x64-20.55.1.exe');
    expect(capturedPath).toBe('C:\\fake\\T2Sales-Setup-x64-20.55.1.exe');
    expect(capturedArgs).toEqual([]); // no silent flags, no arguments at all — real NSIS UI runs
  });

  it('the launched process is unref()d — the desktop app does not wait for the installer to finish', async () => {
    const fs = await import('node:fs');
    (fs.default.stat as unknown as ReturnType<typeof vi.fn>).mockImplementation((_p, cb) => cb(null, { isFile: () => true }));
    const { execFile } = await import('node:child_process');
    const unref = vi.fn();
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '', '');
      return { unref };
    });
    const { launchInstaller } = await import('../src/main/updater/install-launcher.js');
    await launchInstaller('C:\\fake\\T2Sales-Setup-x64-20.55.1.exe');
    expect(unref).toHaveBeenCalled();
  });
});
