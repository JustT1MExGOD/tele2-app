/**
 * §P1-D (20.54.0) — backfill legacy plaintext support_tickets/
 * support_messages rows into the envelope-encryption format
 * (security/crypto/**), so at-rest exposure of pre-encryption support
 * text doesn't sit unaddressed forever. Uses exactly the same AAD
 * context shape as data/repositories/support.ts's decryptTicketRow/
 * decryptMessageRow, so the app can read what this script writes
 * without any special-casing.
 *
 * Resumable/idempotent — only ever touches rows where the relevant
 * `*_encrypted` column IS NULL; each row's UPDATE re-checks that same
 * condition in its WHERE clause, so re-running this script (after an
 * interruption, or by mistake) is a safe no-op on anything already
 * migrated, and two concurrent runs can't double-encrypt the same row.
 * Batched — processes BATCH_SIZE rows per pass and loops until none are
 * left, instead of one giant UPDATE holding a long-lived lock/transaction.
 * Observable — prints row ids/counts as it goes, per batch and at the
 * end. Never logs message/reply/body content — only ids and counts.
 *
 * Deliberately NOT run against production by this pass (see
 * docs/security/20.54-baseline.md, §P1-D) — this repo's write-to-prod-DB
 * discipline requires an explicit, separate confirmation for that, same
 * as any other direct production write outside the migration system.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-support-encryption.ts [--dry-run] [--batch-size=100]
 *   npx tsx src/scripts/backfill-support-encryption.ts --rewrap [--dry-run] [--batch-size=100]
 * (`--rewrap` re-encrypts already-encrypted rows under the CURRENT
 * ENCRYPTION_ACTIVE_KEY_VERSION instead of encrypting plaintext rows —
 * see the rewrap section below for why this exists.)
 * Requires the same env vars the app needs for encryption to work:
 * DATABASE_URL, DATA_ENCRYPTION_ENABLED=true, ENCRYPTION_KEKS,
 * ENCRYPTION_ACTIVE_KEY_VERSION.
 */
import { pathToFileURL } from 'node:url';
import '../env.js';
import { query } from '../data/db/index.js';
import { isEncryptionEnabled, createEnvKeyProvider, encryptField, decryptField, type AadContext } from '../security/crypto/index.js';

const REDACTED = '[зашифровано]';

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rewrap = args.includes('--rewrap');
  const batchArg = args.find((a) => a.startsWith('--batch-size='));
  const batchSize = batchArg ? Math.max(1, Math.min(1000, Number(batchArg.split('=')[1]) || 100)) : 100;
  return { dryRun, rewrap, batchSize };
}

function encrypt(plaintext: string, context: AadContext): string {
  const keyProvider = createEnvKeyProvider();
  const envelope = encryptField(plaintext, context, keyProvider);
  return JSON.stringify(envelope);
}

function decrypt(envelope: unknown, context: AadContext): string {
  const keyProvider = createEnvKeyProvider();
  return decryptField(envelope as any, context, keyProvider);
}

export async function backfillTicketField(
  column: 'message' | 'admin_reply',
  encryptedColumn: 'message_encrypted' | 'admin_reply_encrypted',
  aadType: 'support_ticket.message' | 'support_ticket.admin_reply',
  dryRun: boolean,
  batchSize: number
): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const notNullClause = column === 'admin_reply' ? `${column} IS NOT NULL AND ` : '';
    const { rows } = await query(
      `SELECT id, ${column} AS val FROM support_tickets
       WHERE ${notNullClause}${encryptedColumn} IS NULL
       ORDER BY id LIMIT $1`,
      [batchSize]
    );
    if (!rows.length) break;
    for (const row of rows) {
      scanned++;
      if (dryRun) continue;
      const envelope = encrypt(String(row.val), { type: aadType, id: Number(row.id), schema_v: 1 });
      const res = await query(
        `UPDATE support_tickets SET ${column} = $1, ${encryptedColumn} = $2
         WHERE id = $3 AND ${encryptedColumn} IS NULL`,
        [REDACTED, envelope, row.id]
      );
      if (res.rowCount) updated++;
    }
    console.log(`support_tickets.${column}: batch of ${rows.length} processed (scanned=${scanned}, updated=${updated})`);
    if (dryRun) break; // dry-run never mutates, so the WHERE clause never shrinks — avoid looping forever
  }
  return { scanned, updated };
}

export async function backfillMessages(dryRun: boolean, batchSize: number): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const { rows } = await query(
      `SELECT id, ticket_id, body FROM support_messages WHERE body_encrypted IS NULL ORDER BY id LIMIT $1`,
      [batchSize]
    );
    if (!rows.length) break;
    for (const row of rows) {
      scanned++;
      if (dryRun) continue;
      const envelope = encrypt(String(row.body), {
        type: 'support_message.body',
        id: Number(row.id),
        ticket_id: Number(row.ticket_id)
      });
      const res = await query(
        `UPDATE support_messages SET body = $1, body_encrypted = $2 WHERE id = $3 AND body_encrypted IS NULL`,
        [REDACTED, envelope, row.id]
      );
      if (res.rowCount) updated++;
    }
    console.log(`support_messages.body: batch of ${rows.length} processed (scanned=${scanned}, updated=${updated})`);
    if (dryRun) break;
  }
  return { scanned, updated };
}

/**
 * §P1-D — key rotation "rewrap": ENCRYPTION_KEKS already supports
 * multiple versions simultaneously (security/crypto/key-provider.ts —
 * ENCRYPTION_ACTIVE_KEY_VERSION picks which one NEW writes use;
 * ENCRYPTION_KEKS keeps every version an EXISTING envelope might still
 * reference, so old ciphertext keeps decrypting after rotation with no
 * code change). What that layer does NOT do on its own is migrate
 * EXISTING rows off a retiring key — an operator rotates by adding a
 * new key version and flipping the active pointer, but rows encrypted
 * under the old version stay that way until something re-encrypts them
 * under the new one. This is that something: finds every row whose
 * envelope's `kid` isn't the current active version, decrypts under
 * whatever key the envelope names (any previously-known version still
 * present in ENCRYPTION_KEKS), and re-encrypts under the current active
 * key — same batched/idempotent/no-plaintext-logs discipline as the
 * plaintext backfill above, so an old key can eventually be safely
 * dropped from ENCRYPTION_KEKS once nothing references it any more.
 */
export async function rewrapTicketField(
  column: 'message' | 'admin_reply',
  encryptedColumn: 'message_encrypted' | 'admin_reply_encrypted',
  aadType: 'support_ticket.message' | 'support_ticket.admin_reply',
  activeVersion: string,
  dryRun: boolean,
  batchSize: number
): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const { rows } = await query(
      `SELECT id, ${encryptedColumn} AS env FROM support_tickets
       WHERE ${encryptedColumn} IS NOT NULL AND (${encryptedColumn}->>'kid') <> $1
       ORDER BY id LIMIT $2`,
      [activeVersion, batchSize]
    );
    if (!rows.length) break;
    for (const row of rows) {
      scanned++;
      if (dryRun) continue;
      const context: AadContext = { type: aadType, id: Number(row.id), schema_v: 1 };
      const plaintext = decrypt(row.env, context);
      const envelope = encrypt(plaintext, context);
      const res = await query(
        `UPDATE support_tickets SET ${encryptedColumn} = $1
         WHERE id = $2 AND (${encryptedColumn}->>'kid') <> $3`,
        [envelope, row.id, activeVersion]
      );
      if (res.rowCount) updated++;
    }
    console.log(`rewrap support_tickets.${column}: batch of ${rows.length} processed (scanned=${scanned}, updated=${updated})`);
    if (dryRun) break;
  }
  return { scanned, updated };
}

export async function rewrapMessages(activeVersion: string, dryRun: boolean, batchSize: number): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const { rows } = await query(
      `SELECT id, ticket_id, body_encrypted AS env FROM support_messages
       WHERE body_encrypted IS NOT NULL AND (body_encrypted->>'kid') <> $1
       ORDER BY id LIMIT $2`,
      [activeVersion, batchSize]
    );
    if (!rows.length) break;
    for (const row of rows) {
      scanned++;
      if (dryRun) continue;
      const context: AadContext = { type: 'support_message.body', id: Number(row.id), ticket_id: Number(row.ticket_id) };
      const plaintext = decrypt(row.env, context);
      const envelope = encrypt(plaintext, context);
      const res = await query(
        `UPDATE support_messages SET body_encrypted = $1
         WHERE id = $2 AND (body_encrypted->>'kid') <> $3`,
        [envelope, row.id, activeVersion]
      );
      if (res.rowCount) updated++;
    }
    console.log(`rewrap support_messages.body: batch of ${rows.length} processed (scanned=${scanned}, updated=${updated})`);
    if (dryRun) break;
  }
  return { scanned, updated };
}

async function main() {
  const { dryRun, rewrap, batchSize } = parseArgs();
  if (!isEncryptionEnabled()) {
    console.error('DATA_ENCRYPTION_ENABLED is not true — refusing to run (nothing to backfill into).');
    process.exit(1);
  }

  if (rewrap) {
    const activeVersion = process.env.ENCRYPTION_ACTIVE_KEY_VERSION;
    if (!activeVersion) {
      console.error('ENCRYPTION_ACTIVE_KEY_VERSION is not set — refusing to run.');
      process.exit(1);
    }
    console.log(`Rewrap starting (activeVersion=${activeVersion}, dryRun=${dryRun}, batchSize=${batchSize})`);
    const msg = await rewrapTicketField('message', 'message_encrypted', 'support_ticket.message', activeVersion, dryRun, batchSize);
    const reply = await rewrapTicketField('admin_reply', 'admin_reply_encrypted', 'support_ticket.admin_reply', activeVersion, dryRun, batchSize);
    const bodies = await rewrapMessages(activeVersion, dryRun, batchSize);
    console.log('Rewrap done.', { 'support_tickets.message': msg, 'support_tickets.admin_reply': reply, 'support_messages.body': bodies, dryRun });
    process.exit(0);
  }

  console.log(`Backfill starting (dryRun=${dryRun}, batchSize=${batchSize})`);

  const msg = await backfillTicketField('message', 'message_encrypted', 'support_ticket.message', dryRun, batchSize);
  const reply = await backfillTicketField('admin_reply', 'admin_reply_encrypted', 'support_ticket.admin_reply', dryRun, batchSize);
  const bodies = await backfillMessages(dryRun, batchSize);

  console.log('Done.', {
    'support_tickets.message': msg,
    'support_tickets.admin_reply': reply,
    'support_messages.body': bodies,
    dryRun
  });
  process.exit(0);
}

// Guarded so tests can import backfillTicketField()/backfillMessages()
// directly without triggering a full CLI run (which would process.exit()).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Backfill failed:', e?.message || e);
    process.exit(1);
  });
}
