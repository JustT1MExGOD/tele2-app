/**
 * Draft error types for the schedule-generator application layer.
 */
export class StaleDraftError extends Error {
  constructor() {
    super('Черновик устарел: график, точки или настройки покрытия изменились после расчёта — пересчитайте график');
    Object.assign(this, { statusCode: 409 });
    this.name = 'StaleDraftError';
  }
}

export class DraftHasBlockingErrorsError extends Error {
  constructor(public errors: any[]) {
    super('Черновик содержит блокирующие ошибки — применить его нельзя');
    Object.assign(this, { statusCode: 422 });
    this.name = 'DraftHasBlockingErrorsError';
  }
}

