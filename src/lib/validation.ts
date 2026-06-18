import type { z } from 'zod';
import { ValidationError } from '../errors/app-error';

/**
 * Parses `data` against a Zod schema, throwing a {@link ValidationError} (→ 400)
 * with flattened field issues on failure. Keeps route handlers free of repeated
 * validation boilerplate.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Request validation failed', result.error.flatten());
  }
  return result.data;
}
