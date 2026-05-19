import { Elysia } from 'elysia';

export const requestIdPlugin = new Elysia({ name: 'request-id' }).derive(
  { as: 'global' },
  ({ headers, set }) => {
    const incoming = headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.length > 0 ? incoming : crypto.randomUUID();

    set.headers['x-request-id'] = requestId;

    return { requestId };
  },
);
