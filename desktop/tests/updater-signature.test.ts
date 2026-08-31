import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}));

describe('verifyAuthenticodeSignature — parses PowerShell output, never shells out with an interpolated path', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses a Valid signature with a subject', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify({ status: 'Valid', subject: 'CN=T2 Sales, O=Example' }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    const result = await verifyAuthenticodeSignature('C:\\fake\\T2Sales-Setup-x64-20.55.1.exe');
    expect(result.signed).toBe(true);
    expect(result.status).toBe('Valid');
    expect(result.subject).toBe('CN=T2 Sales, O=Example');
  });

  it('parses NotSigned as unsigned, subject null', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify({ status: 'NotSigned', subject: null }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    const result = await verifyAuthenticodeSignature('C:\\fake\\unsigned.exe');
    expect(result.signed).toBe(false);
    expect(result.status).toBe('NotSigned');
    expect(result.subject).toBeNull();
  });

  it('treats an unrecognized status string as UnknownError rather than crashing', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify({ status: 'SomethingNew', subject: null }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    const result = await verifyAuthenticodeSignature('C:\\fake\\x.exe');
    expect(result.status).toBe('UnknownError');
    expect(result.signed).toBe(false);
  });

  it('rejects when PowerShell fails to run at all', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error('spawn powershell.exe ENOENT'), '', '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    await expect(verifyAuthenticodeSignature('C:\\fake\\x.exe')).rejects.toThrow(/failed to run/);
  });

  it('rejects on unparseable stdout', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, 'not json at all', '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    await expect(verifyAuthenticodeSignature('C:\\fake\\x.exe')).rejects.toThrow(/unparseable/);
  });

  it('passes the file path as a trailing execFile ARGUMENT, never interpolated into the -Command script text', async () => {
    const { execFile } = await import('node:child_process');
    let capturedArgs: string[] = [];
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, args, _opts, cb) => {
      capturedArgs = args as string[];
      cb(null, JSON.stringify({ status: 'NotSigned', subject: null }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    const trickyPath = "C:\\fake\\$(evil); Remove-Item -Recurse C:\\`.exe";
    await verifyAuthenticodeSignature(trickyPath);
    // The path must appear as its own argv element, AFTER the `--`
    // separator, never concatenated into the -Command string itself.
    const commandIndex = capturedArgs.indexOf('-Command');
    const scriptText = capturedArgs[commandIndex + 1];
    expect(scriptText).not.toContain(trickyPath);
    expect(capturedArgs.at(-1)).toBe(trickyPath);
    expect(capturedArgs).toContain('--');
  });

  it('uses execFile (argv array), never exec (shell string) — confirmed by the mock never receiving a single command string', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, args, _opts, cb) => {
      expect(Array.isArray(args)).toBe(true); // execFile's signature — exec would instead take one string
      cb(null, JSON.stringify({ status: 'NotSigned', subject: null }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    await verifyAuthenticodeSignature('C:\\fake\\x.exe');
  });
});

describe('evaluateSignaturePolicy', () => {
  it('never blocks a signed result, regardless of channel', async () => {
    const { evaluateSignaturePolicy } = await import('../src/main/updater/signature.js');
    expect(evaluateSignaturePolicy('stable', { status: 'Valid', signed: true, subject: 'CN=x' })).toBeNull();
    expect(evaluateSignaturePolicy('beta', { status: 'Valid', signed: true, subject: 'CN=x' })).toBeNull();
  });

  it('v1 default policy ("warn") allows unsigned on both channels', async () => {
    const { evaluateSignaturePolicy } = await import('../src/main/updater/signature.js');
    expect(evaluateSignaturePolicy('stable', { status: 'NotSigned', signed: false, subject: null })).toBeNull();
    expect(evaluateSignaturePolicy('beta', { status: 'NotSigned', signed: false, subject: null })).toBeNull();
  });

  it('AUTHENTICODE_POLICY is the one documented place to flip stable to "required" once a real certificate exists', async () => {
    const { AUTHENTICODE_POLICY } = await import('../src/main/updater/signature.js');
    expect(AUTHENTICODE_POLICY.stable).toBe('warn');
    expect(AUTHENTICODE_POLICY.beta).toBe('warn');
  });

  // Security gate §10 — "warn" is lenient ONLY for genuinely-never-signed
  // (NotSigned). A file that CLAIMS a signature but it's broken/tampered
  // is a strictly worse signal than no claim at all, and must always be
  // rejected, on both channels, regardless of the warn/required policy.
  it.each(['HashMismatch', 'NotTrusted', 'Invalid', 'UnknownError'] as const)(
    'a broken/unverifiable signature (%s) is ALWAYS rejected, even under the "warn" policy, on both channels',
    async (status) => {
      const { evaluateSignaturePolicy } = await import('../src/main/updater/signature.js');
      const result = { status, signed: false, subject: null } as const;
      expect(evaluateSignaturePolicy('stable', result)).not.toBeNull();
      expect(evaluateSignaturePolicy('beta', result)).not.toBeNull();
    }
  );

  it('genuinely NotSigned is still allowed under "warn" (distinguishing it from broken-signature statuses is the whole point of the fix)', async () => {
    const { evaluateSignaturePolicy } = await import('../src/main/updater/signature.js');
    const result = { status: 'NotSigned', signed: false, subject: null } as const;
    expect(evaluateSignaturePolicy('stable', result)).toBeNull();
    expect(evaluateSignaturePolicy('beta', result)).toBeNull();
  });
});
