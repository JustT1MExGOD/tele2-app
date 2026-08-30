/**
 * DIRECT mode — the default, preferred path (§11 of the brief). This is
 * deliberately a thin wrapper, not a real "mode" in any networking
 * sense: DIRECT means the app's session uses Electron's completely
 * unmodified default networking (no protocol interception, no proxy) —
 * the BrowserWindow just loads https://<canonical origin>/ like any
 * other website. The only code here is the diagnostics probe used by
 * the state machine to decide whether DIRECT is currently working.
 */
import { runDiagnostics } from './diagnostics';
import type { DiagnosticsReport } from './types';

export function probeDirect(canonicalOrigin: string): () => Promise<DiagnosticsReport> {
  return () => runDiagnostics(canonicalOrigin);
}
