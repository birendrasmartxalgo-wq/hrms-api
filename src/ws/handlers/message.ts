/**
 * handlers/message.ts
 * --------------------
 * Handles `message:send` and `message:read` events.
 *
 * --- message:send ---
 * Wire format (client → server):
 *   {
 *     type: 'message:send',
 *     data: {
 *       tempId: string,          // client-assigned temporary id for optimistic UI
 *       conversationId: string,
 *       text?: string,
 *       type?: 'text' | 'file' | 'image',
 *       file?: { fileName, fileUrl, fileSize, mimeType },
 *       replyTo?: string         // messageId
 *     }
 *   }
 *
 * Behaviour:
 *   1. Insert Message doc.
 *   2. Update Conversation.lastMessage.
 *   3. Publish `message:new` to `conv:<conversationId>` (other members).
 *   4. Publish `message:new` to each participant's `user:<empId>` personal room
 *      (so mobile clients that haven't joined the conv room yet still receive it).
 *   5. Send `message:sent` back to sender with { tempId, message }.
 *
 * --- message:read ---
 * Wire format (client → server):
 *   { type: 'message:read', data: { messageId: string, conversationId: string } }
 *
 * Behaviour:
 *   1. Add reader's employeeId to Message.readBy (idempotent $addToSet).
 *   2. Publish `message:read`   to `conv:<conversationId>`.
 *   3. Publish `message:seenBy` to `conv:<conversationId>` with reader profile snippet.
 */

import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWS = any;

// ─── helpers ──────────────────────────────────────────────────────────────────

function safeObjectId(value: unknown): ObjectId | null {
  if (!value || typeof value !== 'string') return null;
  if (!ObjectId.isValid(value)) return null;
  return new ObjectId(value);
}

function frame(type: string, data: unknown): string {
  return JSON.stringify({ type, data });
}

// ─── message:send ─────────────────────────────────────────────────────────────

export async function handleMessageSend(ws: AnyWS, data: unknown) {
  const d = data as {
    tempId?: string;
    conversationId?: string;
    text?: string;
    type?: 'text' | 'file' | 'image';
    file?: { fileName?: string; fileUrl?: string; fileSize?: number; mimeType?: string };
    replyTo?: string;
  };

  const { tempId, conversationId, text, type: msgType = 'text', file, replyTo } = d ?? {};
  const employeeIdStr = ws.data?.employeeId as string | undefined;

  if (!conversationId || !employeeIdStr) {
    ws.send(
      frame('message:error', {
        tempId,
        code: 'INVALID_PAYLOAD',
        message: 'conversationId and authenticated employeeId are required',
      }),
    );
    return;
  }

  const conversationOid = safeObjectId(conversationId);
  const senderOid = safeObjectId(employeeIdStr);

  if (!conversationOid || !senderOid) {
    ws.send(frame('message:error', { tempId, code: 'INVALID_ID', message: 'Invalid conversationId or employeeId' }));
    return;
  }

  // ── 1. Insert message ──────────────────────────────────────────────────────
  const now = new Date();
  const msgDoc = {
    _id: new ObjectId(),
    conversation: conversationOid,
    sender: senderOid,
    text: text ?? '',
    type: msgType,
    ...(file ? { file } : {}),
    ...(replyTo && safeObjectId(replyTo) ? { replyTo: new ObjectId(replyTo) } : {}),
    readBy: [senderOid],      // sender has implicitly read their own message
    isEdited: false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await collections.messages().insertOne(msgDoc);
  } catch (err) {
    console.error('[ws:message:send] insertOne failed', err);
    ws.send(frame('message:error', { tempId, code: 'DB_ERROR', message: 'Failed to save message' }));
    return;
  }

  // ── 2. Update Conversation.lastMessage ────────────────────────────────────
  try {
    await collections.conversations().updateOne(
      { _id: conversationOid },
      {
        $set: {
          lastMessage: {
            text: text ?? '',
            sender: senderOid,
            timestamp: now,
            type: msgType,
          },
          updatedAt: now,
        },
      },
    );
  } catch (err) {
    // Non-fatal — message was already saved; don't abort the rest.
    console.error('[ws:message:send] lastMessage update failed', err);
  }

  // ── 3 & 4. Broadcast ──────────────────────────────────────────────────────
  // Fetch participants so we can fan out to personal rooms.
  let participants: ObjectId[] = [];
  try {
    const conv = await collections
      .conversations()
      .findOne({ _id: conversationOid }, { projection: { participants: 1 } });
    participants = conv?.participants ?? [];
  } catch (_) {
    // Best-effort; conv room publish still happens.
  }

  const broadcastPayload = frame('message:new', {
    message: {
      _id: msgDoc._id.toHexString(),
      conversation: conversationId,
      sender: employeeIdStr,
      text: msgDoc.text,
      type: msgDoc.type,
      ...(msgDoc.file ? { file: msgDoc.file } : {}),
      ...(msgDoc.replyTo ? { replyTo: msgDoc.replyTo.toHexString() } : {}),
      readBy: [employeeIdStr],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });

  // Publish to conversation room (excludes sender because publishToSelf is false).
  ws.publish(`conv:${conversationId}`, broadcastPayload);

  // Fan out to each participant's personal room (catches mobile clients offline
  // from the conv room, or participants who never called conversation:join).
  for (const participantOid of participants) {
    const pid = participantOid.toHexString();
    if (pid === employeeIdStr) continue; // skip self (handled by message:sent below)
    ws.publish(`user:${pid}`, broadcastPayload);
  }

  // ── 5. Confirm to sender ──────────────────────────────────────────────────
  ws.send(
    frame('message:sent', {
      tempId,
      message: {
        _id: msgDoc._id.toHexString(),
        conversation: conversationId,
        sender: employeeIdStr,
        text: msgDoc.text,
        type: msgDoc.type,
        ...(msgDoc.file ? { file: msgDoc.file } : {}),
        readBy: [employeeIdStr],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    }),
  );
}

// ─── message:read ─────────────────────────────────────────────────────────────

export async function handleMessageRead(ws: AnyWS, data: unknown) {
  const d = data as { messageId?: string; conversationId?: string };
  const { messageId, conversationId } = d ?? {};
  const employeeIdStr = ws.data?.employeeId as string | undefined;

  if (!messageId || !conversationId || !employeeIdStr) return;

  const msgOid = safeObjectId(messageId);
  const empOid = safeObjectId(employeeIdStr);
  if (!msgOid || !empOid) return;

  // ── 1. Persist read receipt ───────────────────────────────────────────────
  try {
    await collections.messages().updateOne(
      { _id: msgOid },
      {
        $addToSet: { readBy: empOid },
        $set: { updatedAt: new Date() },
      },
    );
  } catch (err) {
    console.error('[ws:message:read] updateOne failed', err);
    // Non-fatal; still publish so other clients get the read receipt.
  }

  // ── 2. Publish message:read to conv room ──────────────────────────────────
  ws.publish(
    `conv:${conversationId}`,
    frame('message:read', {
      messageId,
      conversationId,
      readBy: employeeIdStr,
    }),
  );

  // ── 3. Publish message:seenBy with reader profile snippet ─────────────────
  // Fetch minimal employee profile for the reader.
  let readerProfile: Record<string, unknown> = { _id: employeeIdStr };
  try {
    const emp = await collections
      .employees()
      .findOne({ _id: empOid }, { projection: { name: 1, avatar: 1, empId: 1 } });
    if (emp) {
      readerProfile = {
        _id: empOid.toHexString(),
        empId: emp.empId,
        name: emp.name,
        avatar: emp.avatar ?? null,
      };
    }
  } catch (_) {
    // Best-effort enrichment.
  }

  ws.publish(
    `conv:${conversationId}`,
    frame('message:seenBy', {
      messageId,
      conversationId,
      reader: readerProfile,
    }),
  );
}
