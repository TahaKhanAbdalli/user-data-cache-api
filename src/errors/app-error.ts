/**
 * Typed application errors. Each carries an HTTP status and a stable machine
 * code so the central error middleware can translate any thrown error into a
 * consistent JSON response without scattering `res.status(...)` calls through
 * the route handlers.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    // Restore the prototype chain when targeting ES5-ish runtimes / transpilers.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class RateLimitError extends AppError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    details?: unknown,
  ) {
    super(message, 429, 'RATE_LIMITED', details);
  }
}
