/**
 * §24 of the brief. Interface for a future Windows packet-level
 * compatibility layer — NOT implemented this pass (see
 * noop-adapter.ts and docs/adr/desktop-network-transport.md for why:
 * §26/§74 require proof RELAY is insufficient first, via a real-network
 * test this environment cannot perform).
 */

export type NetworkScope = 'app-only';

export interface CompatibilityStatus {
  active: boolean;
  detail: string;
}

export interface NetworkCompatibilityAdapter {
  isSupported(): Promise<boolean>;
  start(scope: NetworkScope): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<CompatibilityStatus>;
}
