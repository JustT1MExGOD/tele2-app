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
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    await expect(verifyAuthenticodeSignature('C:\\fake\\x.exe')).rejects.toThrow(AuthenticodeError);
    await expect(verifyAuthenticodeSignature('C:\\fake\\x.exe')).rejects.toThrow(/Не удалось запустить проверку/);
  });

  it('rejects on unparseable stdout', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, 'not json at all', '');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    await expect(verifyAuthenticodeSignature('C:\\fake\\x.exe')).rejects.toThrow(AuthenticodeError);
    await expect(verifyAuthenticodeSignature('C:\\fake\\x.exe')).rejects.toThrow(/некорректный результат/);
  });

  // §updater-diagnostic-pass — every real-world failure mode gets its own
  // AuthenticodeErrorCategory (item 5) rather than one generic error, so a
  // real machine's updater.log can distinguish D/F/G/H below instead of
  // collapsing them all into "couldn't run PowerShell".

  // D. powershell.exe genuinely missing (item 4's "powershell.exe
  // unavailable" case) — a real spawn failure, error.code is the STRING
  // 'ENOENT'.
  it('D. categorizes a genuine spawn failure (powershell.exe not found) as powershell_not_found', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' });
      cb(err, '', '');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    try {
      await verifyAuthenticodeSignature('C:\\fake\\x.exe');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticodeError);
      expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('powershell_not_found');
    }
  });

  // E. TEMP directory write denied (item 4) — getScriptPath()'s own
  // fs.mkdtempSync throws before execFile is ever called. Scoped
  // node:fs mock + vi.resetModules() (not the static top-level mock, so
  // every other test keeps using real file I/O for the script file).
  it('E. categorizes a failed temp script creation as temp_script_create_failed, without ever invoking PowerShell', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        default: {
          ...actual.default,
          mkdtempSync: () => {
            throw Object.assign(new Error('EACCES: permission denied, mkdtemp'), { code: 'EACCES' });
          }
        }
      };
    });
    try {
      // The static top-level `vi.mock('node:child_process', ...)`
      // factory's vi.fn() instance is shared/reused across resetModules()
      // calls in this file, so we compare call counts before/after
      // rather than asserting zero total calls.
      const { execFile } = await import('node:child_process');
      const callsBefore = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
      try {
        await verifyAuthenticodeSignature('C:\\fake\\x.exe');
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthenticodeError);
        expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('temp_script_create_failed');
      }
      expect((execFile as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  // F. PowerShell spawned but exited non-zero (item 4's AppLocker/WDAC/
  // EDR-blocked-script / constrained-language-mode / GPO-overridden-
  // ExecutionPolicy cases all surface this way) — error.code is a NUMBER.
  it('F. categorizes a non-zero PowerShell exit as powershell_execution_failed', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error('Command failed'), { code: 1 });
      cb(err, '', 'Execution of scripts is disabled on this system');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    try {
      await verifyAuthenticodeSignature('C:\\fake\\x.exe');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticodeError);
      expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('powershell_execution_failed');
    }
  });

  it('categorizes a timed-out PowerShell call as powershell_timeout (killed/signal set by Node\'s own timeout option)', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error('Command timed out'), { killed: true, signal: 'SIGTERM' });
      cb(err, '', '');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    try {
      await verifyAuthenticodeSignature('C:\\fake\\x.exe');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticodeError);
      expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('powershell_timeout');
    }
  });

  // G. PowerShell exits 0 but produces empty stdout (item 4's "stdout
  // empty" case) — must be caught explicitly BEFORE JSON.parse, not left
  // to throw a generic parse error.
  it('G. categorizes empty stdout as powershell_empty_output, distinct from malformed-but-non-empty output', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '', '');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    try {
      await verifyAuthenticodeSignature('C:\\fake\\x.exe');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticodeError);
      expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('powershell_empty_output');
    }
  });

  it('treats whitespace-only stdout the same as empty (powershell_empty_output)', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '   \r\n  ', '');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    try {
      await verifyAuthenticodeSignature('C:\\fake\\x.exe');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticodeError);
      expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('powershell_empty_output');
    }
  });

  // H. malformed (non-empty, non-JSON) stdout — distinct category from
  // empty output, both distinct from a spawn/exit failure.
  it('H. categorizes malformed (non-JSON) stdout as powershell_invalid_json', async () => {
    const { execFile } = await import('node:child_process');
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, 'not json at all', '');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    try {
      await verifyAuthenticodeSignature('C:\\fake\\x.exe');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticodeError);
      expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('powershell_invalid_json');
    }
  });

  // §updater-diagnostic-pass item 4 — real PowerShell output can carry a
  // leading UTF-8 BOM. Stripping it is a narrow, known encoding quirk
  // fix, not lenient/fuzzy parsing — everything else about the JSON
  // still has to parse and validate exactly as before.
  it('strips a leading UTF-8 BOM before parsing, still recovers a valid result', async () => {
    const { execFile } = await import('node:child_process');
    const bom = String.fromCharCode(0xfeff);
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, bom + JSON.stringify({ status: 'NotSigned', subject: null }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    const result = await verifyAuthenticodeSignature('C:\\fake\\x.exe');
    expect(result.status).toBe('NotSigned');
    expect(result.signed).toBe(false);
  });

  it('a BOM alone (no JSON at all) is still treated as empty output, not a parse crash', async () => {
    const { execFile } = await import('node:child_process');
    const bom = String.fromCharCode(0xfeff);
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, bom + '   ', '');
    });
    const { verifyAuthenticodeSignature, AuthenticodeError } = await import('../src/main/updater/signature.js');
    try {
      await verifyAuthenticodeSignature('C:\\fake\\x.exe');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticodeError);
      expect((e as InstanceType<typeof AuthenticodeError>).category).toBe('powershell_empty_output');
    }
  });

  // §updater-postdownload-error regression — the ORIGINAL invocation used
  // `-Command <script> -- <path>`, on the (wrong) assumption that `--`
  // marks the end of powershell.exe's own arguments the way it does in a
  // POSIX shell. Confirmed on a real Windows machine that this is false:
  // PowerShell's `-Command` mode treats every trailing argv element as
  // MORE script text to parse, so `--` itself became a syntax error
  // ("MissingExpressionAfterOperator") on every single real invocation —
  // this never actually worked. `-File <script.ps1> <path>` is the mode
  // that genuinely binds a trailing argv element to $args — confirmed
  // the same way. These tests lock in the NEW, real shape.
  it('invokes PowerShell with -File (not the broken -Command + -- combination), the file path as a trailing execFile ARGUMENT never interpolated into the script', async () => {
    const { execFile } = await import('node:child_process');
    let capturedArgs: string[] = [];
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, args, _opts, cb) => {
      capturedArgs = args as string[];
      cb(null, JSON.stringify({ status: 'NotSigned', subject: null }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    const trickyPath = "C:\\fake\\$(evil); Remove-Item -Recurse C:\\`.exe";
    await verifyAuthenticodeSignature(trickyPath);

    expect(capturedArgs).toContain('-File');
    expect(capturedArgs).not.toContain('-Command');
    expect(capturedArgs).not.toContain('--'); // the broken, misinterpreted separator is gone entirely
    // The path is the LAST argv element — a distinct entry, not woven
    // into the -File script path or anywhere else.
    expect(capturedArgs.at(-1)).toBe(trickyPath);
    const fileIndex = capturedArgs.indexOf('-File');
    const scriptPath = capturedArgs[fileIndex + 1];
    expect(scriptPath).not.toBe(trickyPath);
    expect(scriptPath.endsWith('.ps1')).toBe(true);
  });

  it('the -File script path actually exists on disk and contains Get-AuthenticodeSignature reading $args[0] — not a re-implementation drifting from what runs', async () => {
    const { execFile } = await import('node:child_process');
    let capturedArgs: string[] = [];
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, args, _opts, cb) => {
      capturedArgs = args as string[];
      cb(null, JSON.stringify({ status: 'NotSigned', subject: null }), '');
    });
    const { verifyAuthenticodeSignature } = await import('../src/main/updater/signature.js');
    await verifyAuthenticodeSignature('C:\\fake\\x.exe');

    const fs = await import('node:fs');
    const scriptPath = capturedArgs[capturedArgs.indexOf('-File') + 1];
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('Get-AuthenticodeSignature');
    expect(content).toContain('$args[0]');
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
