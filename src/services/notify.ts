/**
 * services/notify.ts
 * -------------------
 * Persist-then-publish notification helpers.
 *
 * Design contract (MIGRATION-PLAN.md Phase 10 §Notify helpers, spec line 77):
 *   – `notifyEmployee`: insert Notification doc → publish `notification:new` to
 *     `user:<empId>`. If DB write fails, still publish.
 *   – `notifyAll`: query active employees, fan out via notifyEmployee.
 *
 * Publishing uses `app.server?.publish(...)` so it works from REST controllers
 * as well as from WS handlers (see docs/05-elysia-ws.md §6).
 */

import { ObjectId } from 'mongodb';
import { collections } from '../db/collections';
import { ApiError } from '../errors';
import type { NotificationType } from '../db/types/Notification';

export interface NotificationPayload {
  title: string;
  body?: string;
  type?: NotificationType;
  link?: string | null;
}

// ─── internal helpers ──────────────────────────────────────────────────────────

function objectId(value: ObjectId | string, field = 'id') {
  if (value instanceof ObjectId) return value;
  if (!ObjectId.isValid(value)) {
    throw new ApiError(422, 'INVALID_OBJECT_ID', `${field} is not a valid ObjectId`);
  }
  return new ObjectId(value);
}

/**
 * Publish to a WS topic via the Elysia server singleton.
 * The import is deferred (dynamic require-style via getter) to avoid module
 * initialisation order issues between index.ts and this service.
 */
function publishToTopic(topic: string, payload: unknown): void {
  // Lazily import app to avoid circular-import at module evaluation time.
  // We use a try/catch so a missing server (unit tests) never throws.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('../index') as { app: { server?: { publish: (topic: string, data: string) => unknown } | null } };
    app.server?.publish(topic, JSON.stringify(payload));
  } catch {
    // No WS server available (e.g. test environment) — silently skip.
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Persist a notification for one employee and push it over WebSocket.
 *
 * Per spec (line 77): if DB write fails we still publish so the live client
 * sees the event. The notification simply won't survive a page refresh.
 */
export async function notifyEmployee(
  employeeId: ObjectId | string,
  payload: NotificationPayload,
): Promise<void> {
  const empOid = objectId(employeeId, 'employeeId');
  const now = new Date();

  const doc = {
    _id: new ObjectId(),
    employee: empOid,
    title: payload.title,
    body: payload.body ?? '',
    type: payload.type ?? 'info',
    link: payload.link ?? null,
    read: false,
    createdAt: now,
    updatedAt: now,
  };

  // Attempt DB persist (non-fatal).
  let persistedDoc = doc;
  try {
    await collections.notifications().insertOne(doc);
  } catch (err) {
    console.error('[notify] insertOne failed for employee', empOid.toHexString(), err);
    // Still publish per spec line 77 — fall through.
  }

  publishToTopic(`user:${empOid.toHexString()}`, {
    type: 'notification:new',
    data: {
      _id: persistedDoc._id.toHexString(),
      employee: empOid.toHexString(),
      title: persistedDoc.title,
      body: persistedDoc.body,
      type: persistedDoc.type,
      link: persistedDoc.link,
      read: false,
      createdAt: now.toISOString(),
    },
  });
}

/**
 * Fan out a notification to every active employee (optionally skipping one).
 */
export async function notifyAll(
  payload: NotificationPayload,
  excludeEmployeeId?: ObjectId | string | null,
): Promise<void> {
  const excluded = excludeEmployeeId ? objectId(excludeEmployeeId, 'excludeEmployeeId') : null;

  const employees = await collections
    .employees()
    .find({
      isActive: { $ne: false },
      employmentStatus: { $ne: 'former' },
      ...(excluded ? { _id: { $ne: excluded } } : {}),
    })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();

  // Fan out — run concurrently but cap to avoid overwhelming the DB.
  await Promise.all(employees.map((e) => notifyEmployee(e._id, payload)));
}
