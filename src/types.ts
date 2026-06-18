/** A user record as stored in the (mock) database and returned by the API. */
export interface User {
  id: number;
  name: string;
  email: string;
}

/** Payload accepted by `POST /users`. `id` is optional and auto-assigned if omitted. */
export interface CreateUserInput {
  name: string;
  email: string;
  id?: number;
}
