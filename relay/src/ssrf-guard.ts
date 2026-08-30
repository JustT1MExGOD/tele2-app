/**
 * SSRF defense in depth for the relay's OUTBOUND connection to
 * RELAY_UPSTREAM_ORIGIN. Two separate properties, stated precisely (per
 * plan review — not one blanket "impossible" claim):
 *
 * 1. Client-controlled SSRF is structurally prevented — no client input
 *    anywhere in this service is ever interpreted as a destination host/
 *    port/URL (see forward.ts's strict origin-form path validation).
 *    That property doesn't need this file at all.
 *
 * 2. RELAY_UPSTREAM_ORIGIN itself is a trusted deployment-config value
 *    (same trust level as any other *_ORIGIN config in this project),
 *    not a client-facing input — but a ONE-TIME startup DNS check on
 *    that value would still be insufficient defense in depth, because
 *    Node's outbound HTTP client re-resolves the hostname on every new
 *    connection, and a DNS record that changed after startup would
 *    silently bypass a startup-only check (DNS rebinding). This file's
 *    `safeLookup` is a custom `dns.lookup`-shaped function, passed to the
 *    outbound https.Agent, that re-validates the resolved address on
 *    EVERY connection attempt — not just once at boot.
 */
import dns from 'node:dns';
import net from 'node:net';

export class SsrfBlockedError extends Error {}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed = blocked
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isBlockedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — check the embedded v4 address too.
    const v4 = normalized.slice('::ffff:'.length);
    if (net.isIPv4(v4)) return isBlockedIPv4(v4);
  }
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local (RFC4193)
  return false;
}

export function isBlockedAddress(address: string, family: number): boolean {
  if (family === 4 || net.isIPv4(address)) return isBlockedIPv4(address);
  if (family === 6 || net.isIPv6(address)) return isBlockedIPv6(address);
  return true; // unknown family — fail closed
}

/**
 * Drop-in replacement for the `lookup` option accepted by Node's `http`/
 * `https` Agent (`net.LookupFunction`'s exact shape — the callback's
 * `address` can be a single string OR a `LookupAddress[]` when
 * `options.all` is set). Resolves fresh on every call — the Agent calls
 * this per connection, which is exactly the per-connection
 * re-validation this module exists for.
 */
export function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
): void {
  // dns.lookup()'s overloads are selected by the literal shape of
  // `options.all` at the type level — since this function accepts the
  // general `dns.LookupOptions` (not a literal-narrowed variant, because
  // it must match whatever the caller — the https.Agent — passes at
  // runtime), TypeScript can't statically pick one overload. The cast
  // below is deliberate: the runtime logic immediately re-discriminates
  // on `Array.isArray(address)`, which is exactly what the real
  // overloaded behavior does, so this is safe despite losing static
  // overload matching.
  const handleResult = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => {
    if (err) {
      callback(err, '', 0);
      return;
    }
    if (Array.isArray(address)) {
      const blocked = address.find((a) => isBlockedAddress(a.address, a.family));
      if (blocked) {
        callback(new SsrfBlockedError(`Resolved address for ${hostname} is in a blocked range`), [], 0);
        return;
      }
      callback(null, address);
      return;
    }
    if (isBlockedAddress(address, family ?? 0)) {
      callback(new SsrfBlockedError(`Resolved address for ${hostname} is in a blocked range`), '', 0);
      return;
    }
    callback(null, address, family);
  };
  dns.lookup(hostname, options, handleResult as never);
}
