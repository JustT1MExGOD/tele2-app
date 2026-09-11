/**
 * T2 Academy — sandboxed replacement-shift practice (Chapter 1). Must
 * never call the real API — a pure, synchronous, offline simulation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveTrainingStoreCode, TRAINING_STORE_CODE } from '../src/features/tutorial/practice/replacement-practice.js';

describe('replacement-practice sandbox', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the training code resolves to a training store in REPLACEMENT-explaining shape', () => {
    const result = resolveTrainingStoreCode(TRAINING_STORE_CODE);
    expect(result.allowed).toBe(true);
    expect(result.store?.code).toBe(TRAINING_STORE_CODE);
    expect(result.store?.name).toBeTruthy();
    expect(result.store?.address).toBeTruthy();
  });

  it('any other code is rejected with a helpful message naming the training code', () => {
    const result = resolveTrainingStoreCode('000000');
    expect(result.allowed).toBe(false);
    expect(result.store).toBeUndefined();
    expect(result.message).toContain(TRAINING_STORE_CODE);
  });

  it('whitespace around a valid code is tolerated', () => {
    expect(resolveTrainingStoreCode(`  ${TRAINING_STORE_CODE}  `).allowed).toBe(true);
  });

  it('never calls fetch/window.apiClient — genuinely offline, no real store/org is ever touched', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const apiClientSpy = { resolveStore: vi.fn(), openShift: vi.fn() };
    vi.stubGlobal('apiClient', apiClientSpy);

    resolveTrainingStoreCode(TRAINING_STORE_CODE);
    resolveTrainingStoreCode('wrong-code');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(apiClientSpy.resolveStore).not.toHaveBeenCalled();
    expect(apiClientSpy.openShift).not.toHaveBeenCalled();
  });
});
