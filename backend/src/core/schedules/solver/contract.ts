/**
 * Contract between the schedule-generator's domain/application code and the
 * concrete MILP solver implementation (20.58.0 architecture split, corr. #4:
 * "javascript-lp-solver must NOT live in domain"). LpModel is deliberately
 * shaped like javascript-lp-solver's own input format — it's already a
 * fairly generic LP-model shape, so this contract doesn't invent a second
 * translation layer that provides no practical value; the one thing it does
 * enforce is that `domain/solve-model.ts` never imports the library itself,
 * only this interface, and receives a concrete solver via the application
 * layer (parameter injection, no DI framework).
 */
export interface LpModel {
  optimize: string;
  opType: string;
  constraints: Record<string, any>;
  variables: Record<string, any>;
  binaries: Record<string, 1>;
  timeout: number;
}

export interface LpSolveResult {
  feasible?: boolean;
  bounded?: boolean;
  isIntegral?: boolean;
  [varName: string]: any;
}

export interface ScheduleSolver {
  solve(model: LpModel): LpSolveResult;
}
