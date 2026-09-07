import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Deterministic SHA-256 over every file in source/, sorted by filename,
 * as "<name>\n<byte-length>\n<content>" per file. Used as the operator's
 * proof-of-review token for the apply safety switch (--confirm-production
 * must equal this value's first 16 hex chars, exactly as printed by the
 * dry-run report) — ties the confirmation to the EXACT data being
 * imported, not just to running the command.
 */
export function computeSourceFingerprint(sourceDir: string): string {
  const files = readdirSync(sourceDir).filter((f) => f.endsWith('.csv')).sort();
  const hash = createHash('sha256');
  for (const f of files) {
    const buf = readFileSync(path.join(sourceDir, f));
    hash.update(f);
    hash.update('\n');
    hash.update(String(buf.length));
    hash.update('\n');
    hash.update(buf);
  }
  return hash.digest('hex');
}
