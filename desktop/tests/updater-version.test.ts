import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isNewerVersion } from '../src/main/updater/version.js';

describe('parseVersion', () => {
  it('parses a normal MAJOR.MINOR.PATCH string', () => {
    expect(parseVersion('20.55.1')).toEqual([20, 55, 1]);
  });
  it('rejects non-numeric segments', () => {
    expect(parseVersion('20.55.1-beta')).toBeNull();
    expect(parseVersion('v20.55.1')).toBeNull();
    expect(parseVersion('20.x.1')).toBeNull();
  });
  it('rejects empty/whitespace/malformed input', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('   ')).toBeNull();
    expect(parseVersion('...')).toBeNull();
    expect(parseVersion('20..1')).toBeNull();
  });
  it('rejects negative-looking or absurdly long inputs', () => {
    expect(parseVersion('-1.0.0')).toBeNull();
    expect(parseVersion(Array(20).fill('1').join('.'))).toBeNull();
  });
});

describe('compareVersions / isNewerVersion — never a string comparison', () => {
  it('20.55.1 > 20.55.0', () => {
    expect(compareVersions('20.55.1', '20.55.0')).toBeGreaterThan(0);
    expect(isNewerVersion('20.55.0', '20.55.1')).toBe(true);
  });
  it('20.56.0 > 20.55.99 — the exact case a naive string compare gets wrong', () => {
    expect(compareVersions('20.56.0', '20.55.99')).toBeGreaterThan(0);
    expect(isNewerVersion('20.55.99', '20.56.0')).toBe(true);
  });
  it('20.55.2 > 20.55.10 is FALSE numerically (string comparison would wrongly say true)', () => {
    expect(compareVersions('20.55.2', '20.55.10')).toBeLessThan(0);
    expect(isNewerVersion('20.55.2', '20.55.10')).toBe(true);
    expect(isNewerVersion('20.55.10', '20.55.2')).toBe(false);
  });
  it('equal versions are neither newer', () => {
    expect(compareVersions('20.55.0', '20.55.0')).toBe(0);
    expect(isNewerVersion('20.55.0', '20.55.0')).toBe(false);
  });
  it('older versions are not newer — no automatic downgrade', () => {
    expect(isNewerVersion('20.55.1', '20.55.0')).toBe(false);
    expect(isNewerVersion('20.56.0', '20.55.99')).toBe(false);
  });
  it('malformed candidate or current version never compares as newer', () => {
    expect(isNewerVersion('20.55.0', 'garbage')).toBe(false);
    expect(isNewerVersion('garbage', '20.55.0')).toBe(false);
    expect(compareVersions('20.55.0', 'garbage')).toBeNull();
  });
  it('handles differing segment counts (20.55 vs 20.55.0)', () => {
    expect(compareVersions('20.55', '20.55.0')).toBe(0);
    expect(isNewerVersion('20.55', '20.55.1')).toBe(true);
  });
});
