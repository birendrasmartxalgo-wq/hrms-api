/**
 * handlers/conversation.ts
 * -------------------------
 * Handles `conversation:join` and `conversation:leave` events.
 *
 * Wire format (client → server):
 *   { type: 'conversation:join',  data: { conversationId: string } }
 *   { type: 'conversation:leave', data: { conversationId: string } }
 *
 * Behaviour:
 *   join  → ws.subscribe('conv:<conversationId>')
 *   leave → ws.unsubscribe('conv:<conversationId>')
 *
 * No DB validation is done here — membership checks are the caller's concern
 * (enforced in the REST layer when the conversation was fetched / created).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWS = any;

export function handleConversationJoin(ws: AnyWS, data: unknown) {
  const d = data as { conversationId?: string };
  const id = d?.conversationId;
  if (!id) return;
  ws.subscribe(`conv:${id}`);
}

export function handleConversationLeave(ws: AnyWS, data: unknown) {
  const d = data as { conversationId?: string };
  const id = d?.conversationId;
  if (!id) return;
  ws.unsubscribe(`conv:${id}`);
}
