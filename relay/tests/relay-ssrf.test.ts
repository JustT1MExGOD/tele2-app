import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns';
import { isBlockedAddress, safeLookup, SsrfBlockedError } from '../src/ssrf-guard.js';
import { validateOriginFormPath, InvalidRelayPathError, forwardToUpstream, createUpstreamAgent } from '../src/forward.js';
import { startLocalHttpsServer, TEST_CA_CERT, type LocalHttpsServer } from './helpers/local-https-server.js';

describe('isBlockedAddress — RFC1918/loopback/link-local/metadata (RELAY-05..11)', () => {
  const cases: Array<[string, number, boolean, string]> = [
    ['127.0.0.1', 4, true, 'RELAY-05 loopback'],
    ['10.0.0.1', 4, true, 'RELAY-07 10/8'],
    ['172.16.0.1', 4, true, 'RELAY-08 172.16/12'],
    ['172.31.255.255', 4, true, 'RELAY-08 172.16/12 upper bound'],
    ['192.168.1.1', 4, true, 'RELAY-09 192.168/16'],
    ['169.254.169.254', 4, true, 'RELAY-10/RELAY-11 link-local + cloud metadata'],
    ['169.254.1.1', 4, true, '169.254.0.0/16 general link-local range, not just the metadata IP'],
    ['::1', 6, true, 'RELAY-06 IPv6 loopback'],
    ['fe80::1', 6, true, 'IPv6 link-local'],
    ['fd00::1', 6, true, 'IPv6 unique-local (RFC4193, fd00::/8 half)'],
    ['fc00::1', 6, true, 'IPv6 unique-local (RFC4193, fc00::/8 half — the other half of fc00::/7)'],
    // §17 of the verification pass: IPv4-mapped IPv6 must inherit the
    // embedded v4 address's policy — a real gap this matrix didn't cover
    // before (isBlockedAddress's code already handled it; this is the
    // missing test proving it).
    ['::ffff:127.0.0.1', 6, true, 'IPv4-mapped IPv6 loopback'],
    ['::ffff:169.254.169.254', 6, true, 'IPv4-mapped IPv6 cloud metadata'],
    ['::ffff:8.8.8.8', 6, false, 'IPv4-mapped IPv6, public address — not blocked'],
    ['8.8.8.8', 4, false, 'public IPv4 not blocked'],
    ['1.1.1.1', 4, false, 'public IPv4 not blocked'],
    ['2606:4700:4700::1111', 6, false, 'public IPv6 not blocked']
  ];
  for (const [address, family, expected, label] of cases) {
    it(`${label}: ${address} → blocked=${expected}`, () => {
      expect(isBlockedAddress(address, family)).toBe(expected);
    });
  }
});

describe('decimal/octal/hex IP-literal host tricks — why they are not a relevant attack surface here', () => {
  it('localhost resolves to a blocked address via the real system resolver', async () => {
    // "localhost-like names" from §17's checklist — confirmed against
    // the REAL system resolver (deterministic: localhost always
    // resolves to a loopback address on every real platform), not
    // mocked, since this is exactly the case a mock could get wrong.
    const dnsPromises = await import('node:dns/promises');
    const { address, family } = await dnsPromises.lookup('localhost');
    expect(isBlockedAddress(address, family)).toBe(true);
  });

  it('documents why decimal/octal/hex IP-literal host forms (e.g. http://2130706433/, http://0x7f.0.0.1/) are not a client-facing attack surface in this architecture', () => {
    // The desktop client NEVER supplies a hostname/URL at all — only a
    // strict origin-form PATH (validateOriginFormPath, forward.ts),
    // always starting with exactly one "/". The actual upstream HOST
    // comes exclusively from RELAY_UPSTREAM_ORIGIN, trusted server-side
    // config. A path like "/2130706433" is just an ordinary path
    // segment forwarded to the trusted upstream — it is never parsed as
    // a hostname anywhere in this codebase. The only place a hostname
    // string is ever resolved is RELAY_UPSTREAM_ORIGIN's own hostname,
    // via safeLookup() — and dns.lookup() always returns a canonical
    // dotted-decimal/colon-hex address regardless of what notation
    // produced it, which isBlockedAddress() then checks. This test
    // exists so the reasoning is written down and machine-checked
    // (calling validateOriginFormPath with an IP-literal-shaped path
    // proves it's treated as an ordinary path, not a destination).
    expect(() => validateOriginFormPath('/2130706433')).not.toThrow();
    expect(() => validateOriginFormPath('/0x7f.0.0.1')).not.toThrow();
    // Both are accepted as ORDINARY PATHS (forwarded to the trusted
    // upstream, never interpreted as a destination) — not because the
    // relay is lenient about hosts, but because it never looks at this
    // string as a host at all.
  });
});

describe('safeLookup — per-connection DNS validation (DNS rebinding defense)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects when DNS resolves to a blocked address', () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, cb: any) => {
      cb(null, '127.0.0.1', 4);
    }) as never);
    const cb = vi.fn();
    safeLookup('evil.example', { family: 0 } as dns.LookupOptions, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(SsrfBlockedError), '', 0);
  });

  it('allows a public address', () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, cb: any) => {
      cb(null, '8.8.8.8', 4);
    }) as never);
    const cb = vi.fn();
    safeLookup('good.example', { family: 0 } as dns.LookupOptions, cb);
    expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });

  // The core DNS-rebinding property: the SAME hostname resolving to a
  // DIFFERENT (blocked) address on a LATER call is still caught — this
  // is what a per-connection lookup buys over a one-time startup check.
  it('re-validates on every call — a hostname that starts public and later rebinds to a blocked address is caught on the second call', () => {
    const lookupMock = vi
      .spyOn(dns, 'lookup')
      .mockImplementationOnce(((_h: string, _o: unknown, cb: any) => cb(null, '8.8.8.8', 4)) as never)
      .mockImplementationOnce(((_h: string, _o: unknown, cb: any) => cb(null, '169.254.169.254', 4)) as never);

    const first = vi.fn();
    safeLookup('rebinding.example', { family: 0 } as dns.LookupOptions, first);
    expect(first).toHaveBeenCalledWith(null, '8.8.8.8', 4);

    const second = vi.fn();
    safeLookup('rebinding.example', { family: 0 } as dns.LookupOptions, second);
    expect(second).toHaveBeenCalledWith(expect.any(SsrfBlockedError), '', 0);
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });
});

describe('validateOriginFormPath — RELAY-01/02 client cannot select a destination', () => {
  it('accepts normal origin-form paths', () => {
    expect(validateOriginFormPath('/api/me')).toBe('/api/me');
    expect(validateOriginFormPath('/healthz')).toBe('/healthz');
    expect(validateOriginFormPath('/assets/app.js?v=1')).toBe('/assets/app.js?v=1');
  });

  it('RELAY-01 rejects an absolute URL (arbitrary host)', () => {
    expect(() => validateOriginFormPath('https://evil.example/path')).toThrow(InvalidRelayPathError);
    expect(() => validateOriginFormPath('http://evil.example/path')).toThrow(InvalidRelayPathError);
  });

  it('rejects a protocol-relative reference', () => {
    expect(() => validateOriginFormPath('//evil.example/path')).toThrow(InvalidRelayPathError);
    expect(() => validateOriginFormPath('/\\evil.example/path')).toThrow(InvalidRelayPathError);
  });

  it('rejects CR/LF (header/response-splitting defense)', () => {
    expect(() => validateOriginFormPath('/api\r\nX-Injected: 1')).toThrow(InvalidRelayPathError);
    expect(() => validateOriginFormPath('/api\nX-Injected: 1')).toThrow(InvalidRelayPathError);
  });

  it('rejects a fragment', () => {
    expect(() => validateOriginFormPath('/api/me#fragment')).toThrow(InvalidRelayPathError);
  });

  it('rejects a path not starting with exactly one slash', () => {
    expect(() => validateOriginFormPath('api/me')).toThrow(InvalidRelayPathError);
  });
});

describe('forwardToUpstream — the upstream is always the configured origin, never client-influenced', () => {
  let server: LocalHttpsServer | null = null;
  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('after building the URL, asserts its origin matches the configured upstream exactly (defense in depth) — real request against a local, deterministic fixture, no production/internet dependency', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    const agent = createUpstreamAgent(TEST_CA_CERT);
    // A validly-shaped path cannot, by construction, produce a different
    // origin than the one passed in — this test documents and locks in
    // that invariant rather than only relying on path validation.
    await expect(
      forwardToUpstream(
        { method: 'GET', path: '/healthz', hadOriginHeader: false, clientHeaders: new Headers(), body: null },
        server.origin,
        agent
      )
    ).resolves.toMatchObject({ status: 200 });
  });

  it('RELAY-02 CONNECT-shaped requests are rejected by method validation before any network call is made', async () => {
    // No local server needed at all — method validation happens before
    // any connection attempt, which this test itself proves: an
    // unreachable-but-plausible origin never gets contacted.
    const agent = createUpstreamAgent();
    await expect(
      forwardToUpstream(
        { method: 'CONNECT', path: '/healthz', hadOriginHeader: false, clientHeaders: new Headers(), body: null },
        'https://upstream.invalid',
        agent
      )
    ).rejects.toThrow(InvalidRelayPathError);
  });
});
