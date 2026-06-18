import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler';
import { parseOrThrow } from '../lib/validation';
import type { UserService } from '../services/user-service';

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const CreateUserSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    name: z.string().trim().min(1).max(200),
    email: z.string().email(),
  })
  .strict();

/** Routes for the user data API: `GET /users/:id` and `POST /users`. */
export function usersRouter(service: UserService): Router {
  const router = Router();

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseOrThrow(IdParamSchema, req.params);
      const user = await service.getById(id);
      res.json(user);
    }),
  );

  router.post(
    '/',
    asyncHandler((req, res) => {
      const input = parseOrThrow(CreateUserSchema, req.body);
      const user = service.create(input);
      res.status(201).json(user);
      return Promise.resolve();
    }),
  );

  return router;
}
