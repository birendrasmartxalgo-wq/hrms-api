/**
 * handlers/typing.ts
 * -------------------
 * Handles `typing:start` and `typing:stop` events.
 *
 * Wire format (client → server):
 *   { type: 'typing:start', data: { conversationId: string } }
 *   { type: 'typing:stop',  data: { conversationId: string } }
 *
 * Behaviour:
 *   Re-publish the event to `conv:<conversationId>` so that every participant in
 *   the same conversation room sees the typing indicator.
 *
 * The sender's employeeId is injected from ws.data (set during upgrade auth) so
 *   recipients know *who* is typing without the client including it in the payload.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWS = any;

function relay(ws: AnyWS, type: 'typing:start' | 'typing:stop', data: unknown) {
  const d = data as { conversationId?: string };
  const id = d?.conversationId;
  if (!id) return;

  ws.publish(
    `conv:${id}`,
    JSON.stringify({
      type,
      data: {
        conversationId: id,
        employeeId: ws.data?.employeeId,
      },
    }),
  );
}

export function handleTypingStart(ws: AnyWS, data: unknown) {
  relay(ws, 'typing:start', data);
}

export function handleTypingStop(ws: AnyWS, data: unknown) {
  relay(ws, 'typing:stop', data);
}
