/**
 * Sandboxed shift open/close toggle — pure local state, never calls
 * POST /shifts/open|close. Used by Chapter 2's "open a shift" practice and
 * the final challenge (see practice/replacement-practice.ts and
 * sale-practice.ts for the other two sandboxed missions this course reuses).
 */
export class TrainingShiftSandbox {
  private open = false;

  isOpen(): boolean {
    return this.open;
  }

  openShift(): void {
    this.open = true;
  }

  closeShift(): void {
    this.open = false;
  }
}
