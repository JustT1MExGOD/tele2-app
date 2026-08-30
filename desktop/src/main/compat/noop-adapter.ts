/**
 * The only NetworkCompatibilityAdapter implementation this pass ships.
 * `isSupported()` always returns false, so nothing in the network state
 * machine ever routes to WINDOWS_COMPAT regardless of the
 * DESKTOP_WINDOWS_COMPAT_ENABLED flag's value — the flag alone cannot
 * turn on any low-level networking code, because there isn't any this
 * pass. See docs/adr/desktop-network-transport.md.
 */
import type { NetworkCompatibilityAdapter, NetworkScope, CompatibilityStatus } from './adapter';

export class NoopWindowsCompatibilityAdapter implements NetworkCompatibilityAdapter {
  async isSupported(): Promise<boolean> {
    return false;
  }

  async start(_scope: NetworkScope): Promise<void> {
    throw new Error('WindowsCompatibilityAdapter is not implemented in this release');
  }

  async stop(): Promise<void> {
    // No-op — nothing was ever started.
  }

  async getStatus(): Promise<CompatibilityStatus> {
    return { active: false, detail: 'not_implemented' };
  }
}
