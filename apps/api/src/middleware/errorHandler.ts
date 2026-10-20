import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.issues,
      },
    });
    return;
  }
  if (res.headersSent) {
    next(error);
    return;
  }
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : 500;
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : status === 413
        ? 'PAYLOAD_TOO_LARGE'
        : 'INTERNAL_ERROR';
  const message =
    error instanceof Error && (status < 500 || code !== 'INTERNAL_ERROR')
      ? error.message
      : 'An unexpected server error occurred';
  res.status(status).json({
    success: false,
    error: {
      code,
      message,
    },
  });
};
