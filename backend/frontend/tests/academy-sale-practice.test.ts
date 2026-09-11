/**
 * T2 Academy — sale-practice mission reuses the existing add-sale dry-run
 * mechanism (see features/add-sale/index.ts's own doc comment) rather than
 * a second simulated form; this only adds target-matching on top.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { beginSalePractice, CHAPTER2_SALE_TARGET } from '../src/features/tutorial/practice/sale-practice.js';

describe('sale-practice sandbox mission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).__tutorialDryRun;
    delete (window as any).__tutorialDryRunCallback;
  });

  it('sets the dry-run flag and opens the real add-sale form before resolving', async () => {
    const openAddSale = vi.fn();
    vi.stubGlobal('openAddSale', openAddSale);
    const promise = beginSalePractice(CHAPTER2_SALE_TARGET);
    expect(window.__tutorialDryRun).toBe(true);
    expect(openAddSale).toHaveBeenCalled();
    window.__tutorialDryRunCallback?.({ sim: 1, mnp: 1, employee_id: 1, store_id: 's1' });
    const result = await promise;
    expect(result.matched).toBe(true);
  });

  it('clears the dry-run flag once the form is submitted, regardless of match outcome', async () => {
    vi.stubGlobal('openAddSale', vi.fn());
    const promise = beginSalePractice(CHAPTER2_SALE_TARGET);
    window.__tutorialDryRunCallback?.({ sim: 5 });
    await promise;
    expect(window.__tutorialDryRun).toBe(false);
    expect(window.__tutorialDryRunCallback).toBeNull();
  });

  it('rejects a mismatched quantity (sim=2 instead of 1)', async () => {
    vi.stubGlobal('openAddSale', vi.fn());
    const promise = beginSalePractice(CHAPTER2_SALE_TARGET);
    window.__tutorialDryRunCallback?.({ sim: 2, mnp: 1 });
    const result = await promise;
    expect(result.matched).toBe(false);
    expect(result.got).toEqual({ sim: 2, mnp: 1 });
  });

  it('rejects a missing required metric (only sim, no mnp)', async () => {
    vi.stubGlobal('openAddSale', vi.fn());
    const promise = beginSalePractice(CHAPTER2_SALE_TARGET);
    window.__tutorialDryRunCallback?.({ sim: 1 });
    const result = await promise;
    expect(result.matched).toBe(false);
    expect(result.got).toEqual({ sim: 1, mnp: 0 });
  });

  it('rejects extra unrequested metrics beyond the target (sim=1, mnp=1, AND pa=1)', async () => {
    vi.stubGlobal('openAddSale', vi.fn());
    const promise = beginSalePractice(CHAPTER2_SALE_TARGET);
    window.__tutorialDryRunCallback?.({ sim: 1, mnp: 1, pa: 1 });
    const result = await promise;
    expect(result.matched).toBe(false);
  });

  it('ignores non-metric payload fields (employee_id/store_id/sale_date/client_id) when checking for extras', async () => {
    vi.stubGlobal('openAddSale', vi.fn());
    const promise = beginSalePractice(CHAPTER2_SALE_TARGET);
    window.__tutorialDryRunCallback?.({ sim: 1, mnp: 1, employee_id: 1, store_id: 's1', sale_date: '2026-01-01', client_id: 'abc' });
    const result = await promise;
    expect(result.matched).toBe(true);
  });

  it('if opening the real form throws, resolves as unmatched instead of hanging forever', async () => {
    vi.stubGlobal('openAddSale', () => { throw new Error('boom'); });
    const result = await beginSalePractice(CHAPTER2_SALE_TARGET);
    expect(result.matched).toBe(false);
    expect(window.__tutorialDryRun).toBe(false);
  });
});
