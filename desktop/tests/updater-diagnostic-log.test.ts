/**
 * diagnostic-log.ts — real, un-mocked file I/O (a plain OS temp
 * directory, no vitest module mocks needed) proving the actual
 * append-only write behavior a real machine's updater.log will exhibit,
 * plus the no-op-until-configured guarantee every unit test elsewhere in
 * this suite implicitly relies on (none of them ever call
 * configureUpdaterDiagnosticLog).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  configureUpdaterDiagnosticLog,
  writeUpdaterDiagnostic,
  resetUpdaterDiagnosticLogForTests
} from '../src/main/updater/diagnostic-log.js';

describe('diagnostic-log', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't2sales-diag-log-test-'));
  });

  afterEach(() => {
    resetUpdaterDiagnosticLogForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('is a silent no-op before configureUpdaterDiagnosticLog() is ever called — no file, no throw', () => {
    expect(() => writeUpdaterDiagnostic({ stage: 'DOWNLOAD' })).not.toThrow();
  });

  it('writes one JSON line per call to the configured file, creating parent directories as needed', () => {
    const logPath = path.join(tempDir, 'logs', 'updater.log');
    configureUpdaterDiagnosticLog(logPath);

    writeUpdaterDiagnostic({ stage: 'DOWNLOAD', currentVersion: '20.56.2', targetVersion: '20.56.3', channel: 'beta' });
    writeUpdaterDiagnostic({ stage: 'AUTHENTICODE', authenticodeStatus: 'authenticode_not_signed' });

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.stage).toBe('DOWNLOAD');
    expect(first.currentVersion).toBe('20.56.2');
    expect(first.targetVersion).toBe('20.56.3');
    expect(first.channel).toBe('beta');
    expect(typeof first.time).toBe('string');

    const second = JSON.parse(lines[1]);
    expect(second.stage).toBe('AUTHENTICODE');
    expect(second.authenticodeStatus).toBe('authenticode_not_signed');
  });

  it('never writes a full file path, URL, or PowerShell command line — only the fixed, typed field set', () => {
    const logPath = path.join(tempDir, 'updater.log');
    configureUpdaterDiagnosticLog(logPath);
    writeUpdaterDiagnostic({
      stage: 'SHA256',
      expectedSha256Prefix: 'deadbeef',
      actualSha256Prefix: 'cafebabe',
      fileExists: true,
      expectedSize: 12345,
      receivedSize: 12345
    });
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    const keys = Object.keys(entry).sort();
    // Exactly the declared field set (+ time) — nothing extra ever slips
    // in via a raw error object or similar.
    expect(keys).toEqual(
      ['actualSha256Prefix', 'expectedSha256Prefix', 'expectedSize', 'fileExists', 'receivedSize', 'stage', 'time'].sort()
    );
  });

  it('best-effort: a write failure (e.g. an invalid/unwritable path) never throws out of writeUpdaterDiagnostic', () => {
    // A null byte makes the path invalid on every platform — mkdirSync/
    // appendFileSync will throw internally; the function must swallow it.
    configureUpdaterDiagnosticLog(path.join(tempDir, 'invalid\0path', 'updater.log'));
    expect(() => writeUpdaterDiagnostic({ stage: 'DOWNLOAD' })).not.toThrow();
  });

  // §updater-field-diagnostic-build item 5 — a single caller-supplied
  // string field (e.g. a future Error subclass with an unexpectedly long
  // .name) must never let one log line grow unbounded.
  it('truncates an oversized string field instead of writing it in full', () => {
    const logPath = path.join(tempDir, 'updater.log');
    configureUpdaterDiagnosticLog(logPath);
    const hugeName = 'X'.repeat(50_000);
    writeUpdaterDiagnostic({ stage: 'AUTHENTICODE', errorName: hugeName });
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    expect(entry.errorName.length).toBeLessThan(250);
    expect(entry.errorName.length).toBeLessThan(hugeName.length);
  });

  // Defense-in-depth: even if some future caller mistakenly stuffed a
  // path/URL/secret-shaped value into one of the few free-text string
  // fields (errorName/category), truncation to 200 chars means a
  // realistic full path/URL/token still can't survive intact — on top
  // of the primary guarantee, which is structural: UpdaterDiagnosticEntry
  // simply has no path/url/cookie/authorization/initData/stack field to
  // begin with (see the exact-key-set test above).
  it('a secret-shaped value forced into a free-text field is truncated, not preserved verbatim', () => {
    const logPath = path.join(tempDir, 'updater.log');
    configureUpdaterDiagnosticLog(logPath);
    const fakeSecretPayload =
      'C:\\Users\\someone\\AppData\\Local\\Temp\\t2sales-authenticode-abc123\\check-signature.ps1 ' +
      'https://updates.vincere-mortem.ru/releases/T2Sales-Setup-x64-20.56.3.exe?token=SECRET_VALUE_' +
      'X'.repeat(400) +
      ' Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.fake.signature Cookie: t2_session=abcdef123456';
    writeUpdaterDiagnostic({ stage: 'AUTHENTICODE', errorName: fakeSecretPayload });
    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw).not.toContain(fakeSecretPayload);
    expect(raw.length).toBeLessThan(fakeSecretPayload.length);
  });

  // Bounded growth (item 5) — once the log file would exceed the size
  // cap, it rotates to a single `.1` backup rather than growing forever.
  it(
    'rotates to a single .1 backup once the file would exceed the size cap, keeping total growth bounded',
    () => {
      const logPath = path.join(tempDir, 'updater.log');
      configureUpdaterDiagnosticLog(logPath);

      // Each entry is a few hundred bytes at most (bounded fields) —
      // ~300 bytes/entry x 8000 clears the 2 MiB cap with headroom,
      // forcing a real rotation, without an excessive number of
      // synchronous fs calls slowing the suite down.
      const bigButBoundedField = 'Y'.repeat(200);
      for (let i = 0; i < 8_000; i++) {
        writeUpdaterDiagnostic({ stage: 'AUTHENTICODE', errorName: bigButBoundedField, category: `iteration_${i}` });
      }

      const mainSize = fs.statSync(logPath).size;
      const rotatedPath = logPath + '.1';
      expect(fs.existsSync(rotatedPath)).toBe(true);
      const rotatedSize = fs.statSync(rotatedPath).size;

      // Neither file individually exceeds the cap by more than roughly
      // one entry's worth, so total on-disk footprint stays bounded
      // forever — it does NOT grow proportionally to how many entries
      // were ever written (8,000 entries here, nowhere near 8,000 x
      // entry-size on disk).
      const oneEntryMargin = 2000;
      expect(mainSize).toBeLessThan(2 * 1024 * 1024 + oneEntryMargin);
      expect(rotatedSize).toBeLessThan(2 * 1024 * 1024 + oneEntryMargin);
    },
    20_000
  );

  it('resetUpdaterDiagnosticLogForTests() returns to the no-op state', () => {
    const logPath = path.join(tempDir, 'updater.log');
    configureUpdaterDiagnosticLog(logPath);
    writeUpdaterDiagnostic({ stage: 'DOWNLOAD' });
    expect(fs.existsSync(logPath)).toBe(true);

    resetUpdaterDiagnosticLogForTests();
    const sizeBefore = fs.statSync(logPath).size;
    writeUpdaterDiagnostic({ stage: 'AUTHENTICODE' });
    expect(fs.statSync(logPath).size).toBe(sizeBefore); // unchanged — no-op again
  });
});
