export type ErrorDetails = Array<{ path: string; message: string }>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  override readonly cause?: unknown;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetails;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
