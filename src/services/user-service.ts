import type { LruCache } from '../lib/lru-cache';
import type { SingleFlight } from '../lib/single-flight';
import type { AsyncQueue } from '../lib/async-queue';
import type { UserRepository } from './user-repository';
import { NotFoundError } from '../errors/app-error';
import type { CreateUserInput, User } from '../types';

export interface UserServiceDeps {
  repo: UserRepository;
  cache: LruCache<User>;
  singleFlight: SingleFlight<User>;
  queue: AsyncQueue;
}

/**
 * Orchestrates the read path that the assignment cares about:
 *
 *   cache hit ──────────────────────────────────► return immediately
 *        │ miss
 *        ▼
 *   single-flight (coalesce concurrent misses for the same id)
 *        ▼
 *   async queue (bounded-concurrency simulated DB read)
 *        ▼
 *   populate cache (single writer) ─────────────► return
 *
 * Because the cache write happens *inside* the single-flight worker, exactly
 * one writer populates an entry per miss — satisfying "update the cache only if
 * the data is not already cached" — and concurrent callers share one DB read
 * rather than stampeding the database.
 */
export class UserService {
  constructor(private readonly deps: UserServiceDeps) {}

  async getById(id: number): Promise<User> {
    const key = String(id);

    const cached = this.deps.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    return this.deps.singleFlight.do(key, async () => {
      const user = await this.deps.queue.push(() => this.deps.repo.findById(id));
      if (user === null) {
        // Negative results are intentionally not cached: a 404 should not be
        // sticky if the user is created moments later.
        throw new NotFoundError(`User with id ${id} not found`);
      }
      this.deps.cache.set(key, user);
      return user;
    });
  }

  /** Creates a user, then warms the cache so the first read is a hit. */
  create(input: CreateUserInput): User {
    const user = this.deps.repo.create(input);
    this.deps.cache.set(String(user.id), user);
    return user;
  }
}
