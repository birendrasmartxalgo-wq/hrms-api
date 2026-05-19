/**
 * presence.ts
 * -----------
 * In-process presence registry.
 *
 * Tracks a Set<ElysiaWS-like> per employeeId so that:
 *  – multiple tabs for the same user are handled correctly,
 *  – forced-logout can close every socket for a given employee (single-instance only;
 *    see apps/api/WS-PROTOCOL.md §Multi-instance for the Redis upgrade path).
 *
 * We store the raw socket object so callers can send / close individual connections.
 * The type is kept intentionally loose (`any`) to avoid circular-import issues with
 * Elysia's generated ElysiaWS type; downstream callers cast as needed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWS = any;

/** employeeId (string) → set of live sockets */
const _presence = new Map<string, Set<AnyWS>>();

export const presence = {
  /** Register a new socket for an employee. */
  add(employeeId: string, ws: AnyWS): void {
    let sockets = _presence.get(employeeId);
    if (!sockets) {
      sockets = new Set();
      _presence.set(employeeId, sockets);
    }
    sockets.add(ws);
  },

  /** Remove a socket (called in `close`). */
  remove(employeeId: string, ws: AnyWS): void {
    const sockets = _presence.get(employeeId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) _presence.delete(employeeId);
  },

  /** Returns true if the employee has at least one live socket. */
  isOnline(employeeId: string): boolean {
    return (_presence.get(employeeId)?.size ?? 0) > 0;
  },

  /** Returns the number of live connections for an employee. */
  connectionCount(employeeId: string): number {
    return _presence.get(employeeId)?.size ?? 0;
  },

  /** Iterate over every live socket for an employee (e.g. for forced-logout). */
  getSockets(employeeId: string): Set<AnyWS> {
    return _presence.get(employeeId) ?? new Set();
  },

  /** Snapshot of all currently online employeeIds. */
  onlineIds(): string[] {
    return [..._presence.keys()];
  },
};
