import { Elysia, ValidationError } from 'elysia';
import { ZodError } from 'zod';
import { ApiError } from '../errors';

function validationDetails(error: ValidationError) {
  return error.all.map((issue) => ({
    path: issue.path,
    message: issue.summary,
  }));
}

export const errorPlugin = new Elysia({ name: 'error' }).onError(
  { as: 'global' },
  ({ code, error, status }) => {
    if (error instanceof ApiError) {
      return status(error.statusCode, {
        ok: false,
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    if (error instanceof ZodError) {
      return status(422, {
        ok: false,
        code: 'VALIDATION',
        message: 'Validation failed',
        details: error.issues,
      });
    }

    if (error instanceof ValidationError) {
      return status(422, {
        ok: false,
        code: 'VALIDATION',
        message: 'Validation failed',
        details: validationDetails(error),
      });
    }

    const statusCode = code === 'NOT_FOUND' ? 404 : 500;

    const message = error instanceof Error ? error.message : String(error);

    return status(statusCode, {
      ok: false,
      code,
      message: statusCode === 500 ? 'Internal server error' : message,
    });
  },
);
