/**
 * Sandboxed replacement-shift scenario (Chapter 1's PRACTICE step) —
 * teaches the schedule (plan) vs shift_session (actual work) distinction
 * from a pure frontend simulation. Deliberately makes NO network call at
 * all: POST /shifts/resolve-store is genuinely side-effect-free in
 * production (a preview, not a mutation), but even so this never touches
 * a real store/org — "prefer frontend simulation when backend truth is
 * unnecessary" (see final report's sandbox strategy). No real shift is
 * ever opened; this only simulates the resolve-store PREVIEW step.
 */
export const TRAINING_STORE_CODE = '888967';

export interface TrainingResolveResult {
  allowed: boolean;
  store?: { code: string; name: string; address: string; network: string };
  sectorNote?: string;
  message?: string;
}

export function resolveTrainingStoreCode(code: string): TrainingResolveResult {
  if (code.trim() !== TRAINING_STORE_CODE) {
    return { allowed: false, message: `Код не найден. Для тренировки используй ${TRAINING_STORE_CODE}.` };
  }
  return {
    allowed: true,
    store: {
      code: TRAINING_STORE_CODE,
      name: 'Тренировочная точка',
      address: 'МО, Королёв, Калинина, 2',
      network: 'Т2 Б'
    },
    sectorNote: 'Сектор: подходит'
  };
}
