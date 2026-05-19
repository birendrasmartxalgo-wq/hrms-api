import jwt from '@elysiajs/jwt';
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import { collections } from '../db/collections';
import { env } from '../env';
import { forbidden, unauthorized } from '../errors';
import type { UserRole } from '../db/types/User';

const JwtPayloadSchema = t.Object({
  sub: t.Optional(t.String()),
  id: t.Optional(t.String()),
  userId: t.Optional(t.String()),
  employeeId: t.Optional(t.String()),
  role: t.String(),
  iat: t.Optional(t.Number()),
});

export interface AuthUser {
  userId: string;
  employeeId?: string;
  role: UserRole;
  tokenIssuedAt?: number;
}

function bearer(headers: Record<string, string | undefined>) {
  const header = headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

function normalizeRole(role: string): UserRole {
  if (role === 'admin' || role === 'hr' || role === 'employee') return role;
  throw unauthorized('Invalid token role');
}

async function ensureTokenStillValid(user: AuthUser) {
  if (!ObjectId.isValid(user.userId)) {
    throw unauthorized('Invalid token subject');
  }

  const record = await collections.users().findOne(
    { _id: new ObjectId(user.userId) },
    { projection: { isActive: 1, forcedLogoutAt: 1 } },
  );

  if (!record || record.isActive === false) {
    throw unauthorized('Invalid or expired token');
  }

  if (
    record.forcedLogoutAt &&
    user.tokenIssuedAt &&
    user.tokenIssuedAt * 1000 < record.forcedLogoutAt.getTime()
  ) {
    throw unauthorized('Session terminated by administrator', 'FORCE_LOGOUT');
  }
}

export const authPlugin = new Elysia({ name: 'auth' })
  .use(
    jwt({
      name: 'accessJwt',
      secret: env.JWT_SECRET,
      exp: '15m',
      schema: JwtPayloadSchema,
    }),
  )
  .use(
    jwt({
      name: 'refreshJwt',
      secret: env.JWT_REFRESH_SECRET,
      exp: '7d',
      schema: JwtPayloadSchema,
    }),
  )
  .derive({ as: 'global' }, async ({ headers, accessJwt }) => {
    const token = bearer(headers);
    if (!token) return { user: null };

    const payload = await accessJwt.verify(token);
    if (!payload) {
      throw unauthorized();
    }

    const userId = payload.userId ?? payload.id ?? payload.sub;
    if (!userId) {
      throw unauthorized('Invalid token subject');
    }

    const user: AuthUser = {
      userId,
      employeeId: payload.employeeId,
      role: normalizeRole(payload.role),
      tokenIssuedAt: payload.iat,
    };

    await ensureTokenStillValid(user);

    return { user };
  })
  .macro('authorize', (roles: UserRole[] | true) => ({
    beforeHandle({ user }: { user: AuthUser | null }) {
      if (!user) {
        throw unauthorized('No token provided');
      }

      if (Array.isArray(roles) && !roles.includes(user.role)) {
        throw forbidden();
      }
    },
  }));
