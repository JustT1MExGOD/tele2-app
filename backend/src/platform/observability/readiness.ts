/**
 * 20.32.0 (Production Observability) — bootstrap-complete flag for /readyz.
 *
 * migrations already run to completion in index.ts BEFORE buildApp() is
 * even called (see index.ts's own comment: "непримененные миграции —
 * перед подъёмом приложения, не после"), so by construction this flag is
 * always true by the time any HTTP request could reach /readyz today.
 * It stays a real, separate check (not hardcoded true) so a future async
 * warmup step inside buildApp() — a cache prefill, anything that must
 * finish before this instance should take traffic — has an honest place to
 * gate on, without every caller needing to know that detail changed.
 */
let ready = false;

export function markApplicationReady(): void {
  ready = true;
}

export function isApplicationReady(): boolean {
  return ready;
}

/** Test-only: reset between isolated readiness tests. */
export function resetApplicationReadyForTests(): void {
  ready = false;
}
