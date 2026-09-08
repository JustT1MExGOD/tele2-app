/**
 * The ONLY file in core/schedules/** that imports javascript-lp-solver
 * (20.58.0 split, corr. #4). Everything else — constraint/model building in
 * domain/solve-model.ts, orchestration in application/generate-draft.ts —
 * talks to this through the ScheduleSolver contract.
 */
import * as lpSolverModule from 'javascript-lp-solver';
import type { ScheduleSolver, LpModel, LpSolveResult } from './contract.js';

// Тип d.ts пакета описывает чистый ESM default-export, а фактический CJS
// build делает `module.exports = solver` напрямую — под NodeNext+CJS
// интероп реальная форма импорта на рантайме отличается от заявленного
// типа, поэтому берём any и резолвим оба варианта сами.
const solverLib: { Solve: (model: any, precision?: number, full?: boolean, validate?: boolean) => any } =
  (lpSolverModule as any).default ?? (lpSolverModule as any);

export const lpScheduleSolver: ScheduleSolver = {
  solve(model: LpModel): LpSolveResult {
    return solverLib.Solve(model);
  }
};
