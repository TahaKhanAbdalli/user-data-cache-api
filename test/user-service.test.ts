import { beforeEach, describe, expect, it } from 'vitest';
import { UserService } from '../src/services/user-service';
import { LruCache } from '../src/lib/lru-cache';
import { SingleFlight } from '../src/lib/single-flight';
import { AsyncQueue } from '../src/lib/async-queue';
import { delay } from '../src/lib/delay';
import { NotFoundError } from '../src/errors/app-error';
import type { UserRepository } from '../src/services/user-repository';
import type { CreateUserInput, User } from '../src/types';

/** A repository double that counts DB reads so we can prove caching/coalescing. */
class CountingRepository implements UserRepository {
  findByIdCalls = 0;
  private readonly users: Map<number, User>;
  private maxId: number;

  constructor(
    seed: User[],
    private readonly delayMs = 20,
  ) {
    this.users = new Map(seed.map((u) => [u.id, u]));
    this.maxId = Math.max(0, ...seed.map((u) => u.id));
  }

  async findById(id: number): Promise<User | null> {
    this.findByIdCalls += 1;
    await delay(this.delayMs);
    return this.users.get(id) ?? null;
  }

  has(id: number): boolean {
    return this.users.has(id);
  }

  create(input: CreateUserInput): User {
    const id = input.id ?? this.maxId + 1;
    const user: User = { id, name: input.name, email: input.email };
    this.users.set(id, user);
    this.maxId = Math.max(this.maxId, id);
    return user;
  }
}

function buildService(repo: UserRepository) {
  const cache = new LruCache<User>({ maxEntries: 100, ttlMs: 60_000 });
  const service = new UserService({
    repo,
    cache,
    singleFlight: new SingleFlight<User>(),
    queue: new AsyncQueue({ concurrency: 4 }),
  });
  return { service, cache };
}

describe('UserService', () => {
  let repo: CountingRepository;

  beforeEach(() => {
    repo = new CountingRepository([{ id: 1, name: 'John Doe', email: 'john@example.com' }]);
  });

  it('fetches from the repository on a miss and serves the cache thereafter', async () => {
    const { service } = buildService(repo);

    const first = await service.getById(1);
    const second = await service.getById(1);

    expect(first).toEqual({ id: 1, name: 'John Doe', email: 'john@example.com' });
    expect(second).toEqual(first);
    expect(repo.findByIdCalls).toBe(1); // second call served from cache
  });

  it('coalesces concurrent misses for the same id into a single DB read', async () => {
    const { service } = buildService(repo);

    const results = await Promise.all([
      service.getById(1),
      service.getById(1),
      service.getById(1),
      service.getById(1),
      service.getById(1),
    ]);

    expect(results.every((u) => u.id === 1)).toBe(true);
    expect(repo.findByIdCalls).toBe(1); // five callers, one read
  });

  it('throws NotFoundError for an unknown id and does not cache the negative result', async () => {
    const { service, cache } = buildService(repo);

    await expect(service.getById(999)).rejects.toBeInstanceOf(NotFoundError);
    expect(cache.has('999')).toBe(false);

    // A later, successful create for that id should still work (nothing poisoned).
    await expect(service.getById(999)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.findByIdCalls).toBe(2); // re-attempted, not short-circuited
  });

  it('caches a newly created user so it is served without a DB read', async () => {
    const { service } = buildService(repo);

    const created = service.create({ name: 'Grace Hopper', email: 'grace@example.com' });
    expect(created.id).toBe(2);

    const fetched = await service.getById(created.id);
    expect(fetched).toEqual(created);
    expect(repo.findByIdCalls).toBe(0); // served entirely from cache
  });
});
