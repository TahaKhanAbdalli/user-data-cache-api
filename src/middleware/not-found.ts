import type { RequestHandler } from 'express';
import { NotFoundError } from '../errors/app-error';

/** Terminal handler for unmatched routes; produces a consistent 404 JSON body. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
};
