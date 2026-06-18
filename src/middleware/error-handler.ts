import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/app-error';
import type { Logger } from '../logger';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Central error handler. Translates {@link AppError} instances into their
 * declared status + machine code, and anything unexpected into a generic 500
 * (without leaking internals to the client, while logging the full error).
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error middleware by its arity (4 params), so `_next`
  // must be present even though it is unused on the happy path.
  return (err, _req, res, _next) => {
    if (res.headersSent) {
      return _next(err);
    }

    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        logger.error({ err, code: err.code }, 'request failed');
      } else {
        logger.warn({ code: err.code, statusCode: err.statusCode }, 'request rejected');
      }
      const body: ErrorBody = { error: { code: err.code, message: err.message } };
      if (err.details !== undefined) {
        body.error.details = err.details;
      }
      res.status(err.statusCode).json(body);
      return;
    }

    logger.error({ err }, 'unexpected error');
    const body: ErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    };
    res.status(500).json(body);
  };
}
