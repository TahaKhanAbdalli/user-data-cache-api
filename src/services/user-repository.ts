import { delay } from '../lib/delay';
import { ConflictError } from '../errors/app-error';
import type { CreateUserInput, User } from '../types';

/**
 * Abstraction over the data store. The service depends on this interface rather
 * than a concrete database, which keeps the caching/coalescing logic testable
 * with a fast in-memory double and would let a real DB drop in later.
 */
export interface UserRepository {
  /** Resolves the user or `null`, simulating real database latency. */
  findById(id: number): Promise<User | null>;
  /** Synchronously inserts a new user; throws on a duplicate id. */
  create(input: CreateUserInput): User;
  has(id: number): boolean;
}

/** The mock data the assignment specifies. */
export const SEED_USERS: readonly User[] = [
  { id: 1, name: 'John Doe', email: 'john@example.com' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
  { id: 3, name: 'Alice Johnson', email: 'alice@example.com' },
];

/**
 * In-memory stand-in for a database. Reads incur an artificial delay so the
 * caching and request-coalescing behaviour is observable.
 */
export class MockUserRepository implements UserRepository {
  private readonly users = new Map<number, User>();
  private maxId = 0;

  constructor(
    seed: readonly User[] = SEED_USERS,
    private readonly delayMs = 200,
  ) {
    for (const user of seed) {
      this.users.set(user.id, { ...user });
      this.maxId = Math.max(this.maxId, user.id);
    }
  }

  async findById(id: number): Promise<User | null> {
    await delay(this.delayMs);
    return this.users.get(id) ?? null;
  }

  has(id: number): boolean {
    return this.users.has(id);
  }

  create(input: CreateUserInput): User {
    const id = input.id ?? this.maxId + 1;
    if (this.users.has(id)) {
      throw new ConflictError(`User with id ${id} already exists`);
    }
    const user: User = { id, name: input.name, email: input.email };
    this.users.set(id, user);
    this.maxId = Math.max(this.maxId, id);
    return user;
  }
}
