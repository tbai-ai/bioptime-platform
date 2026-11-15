/* One error shape for the whole API: { error: { code, message, details } } with a sensible HTTP status. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) } };
  }
}

export const errors = {
  validation: (details: unknown, message = 'Some fields need attention') => new AppError('VALIDATION_FAILED', 400, message, details),
  badRequest: (message: string, code = 'BAD_REQUEST') => new AppError(code, 400, message),
  unauthorised: (message = 'Sign in to continue', code = 'UNAUTHORISED') => new AppError(code, 401, message),
  forbidden: (message = 'You do not have access to this', code = 'FORBIDDEN') => new AppError(code, 403, message),
  notFound: (what = 'That record', code = 'NOT_FOUND') => new AppError(code, 404, `${what} was not found`),
  conflict: (message: string, code = 'CONFLICT', details?: unknown) => new AppError(code, 409, message, details),
  state: (message: string, details?: unknown) => new AppError('INVALID_STATE', 409, message, details),
  tooMany: (message = 'Too many attempts. Try again in a few minutes.') => new AppError('RATE_LIMITED', 429, message),
  upstream: (message: string, details?: unknown) => new AppError('UPSTREAM_UNAVAILABLE', 502, message, details),
  internal: (message = 'Something went wrong on our side') => new AppError('INTERNAL', 500, message),
};
