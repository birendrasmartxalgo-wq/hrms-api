/**
 * ws/server.ts
 * -------------
 * Elysia WebSocket endpoint: `GET /api/v1/socket` (upgraded to WS).
 *
 * ─── Auth on upgrade ──────────────────────────────────────────────────────────
 * The Bun WebSocket handshake cannot carry `Authorization` headers from the
 * browser `WebSocket` constructor, so we read the JWT from the `?token=` query
 * parameter in `beforeHandle`.
 *
 * `beforeHandle` runs BEFORE `server.upgrade()` (see docs/05-elysia-ws.md §2),
 * so returning a non-undefined value here aborts the upgrade with an HTTP error.
 *
 * On success, `userId` and `employeeId` are written to `context.store` which
 * becomes `ws.data.store` for the lifetime of the connection (§3).
 *
 * ─── Pub/sub topology ─────────────────────────────────────────────────────────
 * – `user:<employeeId>`        — personal room (notifications, DM delivery)
 * – `conv:<conversationId>`    — per-conversation room (typing, messages)
 *
 * ─── Wire format ──────────────────────────────────────────────────────────────
 * All frames (both directions): { type: string, data: unknown }
 * See apps/api/WS-PROTOCOL.md for the full event catalogue.
 *
 * ─── Multi-instance note ──────────────────────────────────────────────────────
 * In-memory presence + Bun pub/sub are single-process only.
 * See WS-PROTOCOL.md §Multi-instance for the Redis upgrade path.
 */

import { Elysia, t } from 'elysia';
import jwt from '@elysiajs/jwt';
import { ObjectId } from 'mongodb';
import { env } from '../env';
import { presence } from './presence';
import { handleConversationJoin, handleConversationLeave } from './handlers/conversation';
import { handleTypingStart, handleTypingStop } from './handlers/typing';
import { handleMessageSend, handleMessageRead } from './handlers/message';

// ─── JWT setup (mirrors authPlugin but for query-string tokens) ────────────────

const wsJwt = new Elysia({ name: 'ws-jwt' }).use(
  jwt({
    name: 'wsJwt',
    secret: env.JWT_SECRET,
    schema: t.Object({
      sub: t.Optional(t.String()),
      id: t.Optional(t.String()),
      userId: t.Optional(t.String()),
      employeeId: t.Optional(t.String()),
      role: t.String(),
      iat: t.Optional(t.Number()),
    }),
  }),
);

// ─── WebSocket plugin ─────────────────────────────────────────────────────────

export const wsPlugin = new Elysia({ name: 'ws' })
  .use(wsJwt)
  .ws('/socket', {
    // Validate the query string so TypeScript knows `query.token` is a string.
    query: t.Object({
      token: t.String({ minLength: 1 }),
    }),

    // Validate the incoming message frame shape.
    body: t.Object({
      type: t.String(),
      data: t.Optional(t.Unknown()),
    }),

    // ── Upgrade-time auth ────────────────────────────────────────────────────
    // This runs as an HTTP handler before server.upgrade(); returning a value
    // aborts the upgrade with an HTTP response.
    async beforeHandle({ query, wsJwt: jwtPlugin, store, status }) {
      const payload = await (jwtPlugin as any).verify(query.token);

      if (!payload) {
        return status(401, JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid token' }));
      }

      const userId: string | undefined = (payload as any).userId ?? (payload as any).id ?? (payload as any).sub;
      const employeeId: string | undefined = (payload as any).employeeId;

      if (!userId || !ObjectId.isValid(userId)) {
        return status(401, JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid token subject' }));
      }

      // Stash on store — becomes ws.data.store in open/message/close.
      (store as Record<string, unknown>)['__ws_userId'] = userId;
      (store as Record<string, unknown>)['__ws_employeeId'] = employeeId ?? null;
    },

    // ── Connection opened ─────────────────────────────────────────────────────
    open(ws) {
      const s = ws.data.store as Record<string, unknown>;
      const userId: string = s['__ws_userId'] as string;
      const employeeId: string | null = s['__ws_employeeId'] as string | null;

      // Attach to ws.data for handler access.
      (ws.data as any).userId = userId;
      (ws.data as any).employeeId = employeeId;

      if (employeeId) {
        // Register in presence map.
        presence.add(employeeId, ws);

        // Subscribe to personal room.
        ws.subscribe(`user:${employeeId}`);

        // Notify others (first connection only — don't spam if multiple tabs).
        if (presence.connectionCount(employeeId) === 1) {
          ws.publish(
            `user:${employeeId}`,
            JSON.stringify({ type: 'user:online', data: { employeeId } }),
          );
        }
      }

      console.log(`[ws:open] userId=${userId} empId=${employeeId ?? 'n/a'}`);
    },

    // ── Incoming message router ───────────────────────────────────────────────
    async message(ws, msg) {
      const { type, data } = msg as { type: string; data?: unknown };

      switch (type) {
        case 'conversation:join':
          handleConversationJoin(ws, data);
          break;

        case 'conversation:leave':
          handleConversationLeave(ws, data);
          break;

        case 'typing:start':
          handleTypingStart(ws, data);
          break;

        case 'typing:stop':
          handleTypingStop(ws, data);
          break;

        case 'message:send':
          await handleMessageSend(ws, data);
          break;

        case 'message:read':
          await handleMessageRead(ws, data);
          break;

        default:
          ws.send(
            JSON.stringify({
              type: 'error',
              data: { code: 'UNKNOWN_EVENT', message: `Unknown event type: ${type}` },
            }),
          );
      }
    },

    // ── Connection closed ─────────────────────────────────────────────────────
    close(ws, _code, _reason) {
      const employeeId: string | null = (ws.data as any).employeeId ?? null;

      if (employeeId) {
        presence.remove(employeeId, ws);

        // Publish offline only when the last tab closes.
        if (!presence.isOnline(employeeId)) {
          // Use ws.publish — still valid briefly during close handler.
          ws.publish(
            `user:${employeeId}`,
            JSON.stringify({ type: 'user:offline', data: { employeeId } }),
          );
        }
      }

      const userId: string | undefined = (ws.data as any).userId;
      console.log(`[ws:close] userId=${userId ?? 'n/a'} empId=${employeeId ?? 'n/a'}`);
    },
  });
