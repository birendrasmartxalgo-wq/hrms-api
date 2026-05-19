export type ErrorDetails = Record<string, unknown> | unknown[] | undefined;

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const unauthorized = (message = 'Authentication failed', code = 'UNAUTHORIZED') =>
  new ApiError(401, code, message);

export const forbidden = (message = 'Insufficient permissions') =>
  new ApiError(403, 'FORBIDDEN', message);
