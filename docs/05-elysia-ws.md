# Elysia WebSocket 1.4.28 — Allowed APIs

Phase 0 documentation discovery for the Socket.IO → Elysia native WebSocket migration.
All facts below are cited from the installed `elysia@1.4.28` type definitions at
`D:\smartxalgo\smartxalgo-hrms\.scratch\probe\node_modules\elysia\`. Anything not
directly confirmed in those files is flagged **VERIFIED**.

Wire contract (preserved from Socket.IO layer; not Elysia-defined):

- Client→server events: `conversation:join`, `conversation:leave`, `typing:start`,
  `typing:stop`, `message:send`, `message:read`.
- Server→client events: `user:online`, `user:offline`, `typing:start`, `typing:stop`,
  `message:new`, `message:sent`, `message:error`, `message:read`, `message:seenBy`,
  `notification:new`.
- Topics: `user:<employeeId>` (personal) and `conv:<conversationId>` (per conversation).
- Frame: JSON `{ type: string, data: unknown }`.
- Auth: `?token=<jwt>` query string on upgrade URL.

---

## 1. Route definition — `app.ws(path, options)`

**Source:** `node_modules/elysia/dist/index.d.ts:1760`
**Signature (essentials):**
```ts
ws<const Path extends string, ...>(
  path: Path,
  options: WSLocalHook<Input, Schema, Singleton & {...}>
): Elysia<...>
```

`WSLocalHook` is defined at `node_modules/elysia/dist/ws/types.d.ts:25-59` and
combines validation/lifecycle hooks (HTTP-style) with WS-specific callbacks
(`TypedWebSocketHandler` mixin, `types.d.ts:7-20`).

### 1a. Lifecycle / hook keys present on the WS handler

Confirmed by reading `ws/types.d.ts`:

| Key             | Source                              | Param shape                                                  |
|-----------------|-------------------------------------|--------------------------------------------------------------|
| `open`          | `ws/types.d.ts:8`                   | `(ws: ElysiaWS) => MaybePromise<Response \| void>`           |
| `message`       | `ws/types.d.ts:11`                  | `(ws: ElysiaWS, message: Route['body']) => MaybePromise<...>`|
| `close`         | `ws/types.d.ts:15`                  | `(ws, code: number, reason: string) => MaybePromise<...>`    |
| `drain`         | `ws/types.d.ts:12`                  | `(ws: ElysiaWS) => MaybePromise<...>`                        |
| `ping`          | `ws/types.d.ts:18`                  | `(ws, message) => MaybePromise<...>`                         |
| `pong`          | `ws/types.d.ts:19`                  | `(ws, message) => MaybePromise<...>`                         |
| `parse`         | `ws/types.d.ts:31`                  | `MaybeArray<WSParseHandler<Schema>>` — `(ws, message) => Route['body']` |
| `transform`     | `ws/types.d.ts:35`                  | `MaybeArray<TransformHandler<Schema, Singleton>>` (HTTP-style ctx) |
| `beforeHandle`  | `ws/types.d.ts:39`                  | `MaybeArray<OptionalHandler<Schema, Singleton>>` (HTTP-style ctx) |
| `afterHandle`   | `ws/types.d.ts:43`                  | `MaybeArray<OptionalHandler<Schema, Singleton>>`             |
| `mapResponse`   | `ws/types.d.ts:47`                  | `MaybeArray<MapResponse<Schema, Singleton>>`                 |
| `afterResponse` | `ws/types.d.ts:51`                  | `MaybeArray<AfterResponseHandler<Schema, Singleton>>`        |
| `error`         | `ws/types.d.ts:55`                  | `MaybeArray<ErrorHandler<{}, Schema, Singleton>>`            |
| `upgrade`       | `ws/types.d.ts:30`                  | `Record<string, unknown> \| ((context: Context) => unknown)` — adds **headers** to upgrade response |
| `detail`, `tags`| `ws/types.d.ts:26, 56`              | OpenAPI metadata                                             |
| `body`,`response`,`query`,`params`,`headers` | inherited from `InputSchema` via `WSLocalHook` `Input extends BaseMacro` (`ws/types.d.ts:25`) | TypeBox schemas |

> Note: there is **no separate `response` lifecycle hook** — `response` is a
> TypeBox schema, validated via `responseValidator` (`bun/index.mjs:241`).

The runtime ordering (from `dist/adapter/bun/index.mjs:234-289`) is:
**upgrade-header merge → cookie serialization → `beforeHandle` → `server.upgrade(...)` → `open` (after WS opens)**.

---

## 2. Upgrade-time auth (where `query.token` lives)

**Source:** `node_modules/elysia/dist/adapter/bun/index.mjs:251-289`

The WS route is registered as `app.route("WS", path, handler, ...)`. The
`handler` receives a normal HTTP `Context` (has `query`, `headers`, `params`,
`request`, `set`). It runs `options.beforeHandle(context)` and only then calls
`server.upgrade(context.request, { data: {...context, ...} })`.

**Therefore: `beforeHandle` runs BEFORE the upgrade and IS the correct place to
verify `?token=` and reject by throwing / returning a status response.**

```ts
import { Elysia, t } from 'elysia';
import { verify } from 'jsonwebtoken';

app.ws('/ws', {
  query: t.Object({ token: t.String() }),
  beforeHandle({ query, status }) {
    try {
      const payload = verify(query.token, process.env.JWT_SECRET!);
      // Stash on context.store / derive earlier so `open` can read it.
      // Or use Elysia `derive` / `resolve` on the parent app.
    } catch {
      return status(401, 'invalid token');
    }
  },
  open(ws) {
    // ws.data.query.token available here too (see §3)
    ws.subscribe(`user:${ws.data.employeeId}`);
  },
  message(ws, msg) { /* ... */ },
});
```

Returning a non-undefined value from `beforeHandle` short-circuits the upgrade
(standard Elysia HTTP semantics, applied to the WS route handler).

---

## 3. `ws.data` — typed connection state

**Source:** `node_modules/elysia/dist/ws/index.d.ts:14` and `bun/index.mjs:289-296`

`ElysiaWS.data` is `Prettify<Omit<Context, 'body' | 'error' | 'status' | 'redirect'>>`.
At upgrade time the adapter passes the entire HTTP context as `data`:

```js
// bun/index.mjs:289
if (!server?.upgrade(context.request, {
  headers: ...,
  data: {
    ...context,        // query, params, headers, store, request, set, ...
    get id() { ... },  // randomId per-connection
    validator: responseValidator,
    open, message, close, drain, ping, pong, // internal dispatchers
  },
})) { ... }
```

So inside `open`/`message`/`close`, you can read `ws.data.query.token`,
`ws.data.store.*`, `ws.data.headers['x-...']`, etc. **This persists for the
lifetime of the connection** — it is Bun's per-socket `data` slot
(`ws/bun.d.ts:273`: `data: T` on `ServerWebSocket<T>`). Mutations persist across
messages (it is the same object reference).

For derived auth state, put values on `context.store` or use `.derive(...)` /
`.resolve(...)` so they appear on `ws.data`.

---

## 4. Pub/sub — `subscribe` / `unsubscribe` / `publish`

**Source:** `node_modules/elysia/dist/ws/index.d.ts:54-63`, types re-exported
from `ServerWebSocket` in `ws/bun.d.ts:143-199`.

```ts
ws.subscribe(topic: string): void                      // bun.d.ts:173
ws.unsubscribe(topic: string): void                    // bun.d.ts:181
ws.isSubscribed(topic: string): boolean                // bun.d.ts:190
ws.subscriptions: string[]                             // bun.d.ts:199 (readonly)
ws.publish(topic, data, compress?): SendStatus         // index.d.ts:54
ws.publishText(topic, data, compress?)                 // index.d.ts:59
ws.publishBinary(topic, data, compress?)               // index.d.ts:60
```

### Publish-to-self behaviour

**Source:** `node_modules/elysia/dist/ws/bun.d.ts:392-396`

```ts
/** Should `ws.publish()` also send a message to `ws` (itself), if it is subscribed?
 *  Default is `false`. */
publishToSelf?: boolean;
```

**Confirmed: `ws.publish()` does NOT echo to the sender by default.** If a
handler needs to deliver to all members of a conv room *including* the sender,
either:

- call `ws.send(...)` explicitly for the sender plus `ws.publish('conv:X', ...)`
  for the others, **or**
- set `websocket: { publishToSelf: true }` on the Elysia config (see §6 for
  where `websocket` config is consumed: `adapter/bun/index.mjs:171-186`).

---

## 5. Sending to one connection — `ws.send`

**Source:** `node_modules/elysia/dist/ws/index.d.ts:30`

```ts
send(data: FlattenResponse<Route['response']> | BufferSource, compress?: boolean)
  : ServerWebSocketSendStatus
```

Underlying Bun signature accepts `string | BufferSource` (`ws/bun.d.ts:76`).
Elysia wraps `send` so that **non-string/non-buffer values are routed through
`handleResponse` → `createHandleWSResponse`** which calls the response validator
and serializes. See `bun/index.mjs:269` (`handleResponse = createHandleWSResponse(...)`)
and `ws/index.d.ts:76` (`createHandleWSResponse` declaration).

**VERIFIED detail:** The `.d.ts` does not state in prose that `ws.send(obj)`
auto-`JSON.stringify`s a plain object. The `createHandleWSResponse` export
(`ws/index.d.ts:76`) is what runs for return values from `open`/`message`. For
explicit `ws.send(payload)` calls inside handlers, **call `JSON.stringify`
yourself** to stay safe — this matches Bun's raw `ServerWebSocket.send` contract.

```ts
ws.send(JSON.stringify({ type: 'message:sent', data: { id } }));
```

Return value semantics: see §8.

---

## 6. Publishing from OUTSIDE a WS handler (HTTP route → fan out)

This is the critical path for `notification:new` triggered by REST controllers.

**Source:** `node_modules/elysia/dist/index.d.ts:55`

```ts
class Elysia<...> {
  server: Server | null;
  ...
}
```

The `Server` interface (`node_modules/elysia/dist/universal/server.d.ts:210-240`)
exposes:

```ts
/** Send a message to all connected ServerWebSocket subscribed to a topic */
publish(
  topic: string,
  data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
  compress?: boolean
): ServerWebSocketSendStatus;
```

**Pattern for HTTP → WS broadcast:**

```ts
// somewhere in module scope:
export const app = new Elysia()
  .ws('/ws', { /* ... */ })
  // ... other routes
  .listen(5000);

// later, inside any HTTP controller / service:
app.server?.publish(
  `user:${employeeId}`,
  JSON.stringify({ type: 'notification:new', data: notif }),
);
```

`app.server` becomes non-null after `Bun.serve(...)` runs
(`adapter/bun/index.mjs:190`: `app.server = Bun.serve(serve)`). Before
`app.listen()`, `app.server` is `null` — guard with `?.`.

> **Note:** `server.publish` is **always** to-others (it has no sender), so the
> `publishToSelf` option does not apply here. Every subscribed client receives.

---

## 7. `body` schema for incoming WS messages

**Source:** `node_modules/elysia/dist/ws/types.d.ts:11` and `bun/index.mjs:235-241`

`WSLocalHook` includes the standard `InputSchema` fields via `Input extends BaseMacro`
(line 25). The adapter destructures `body` and builds a TypeBox validator:

```js
// bun/index.mjs:235
const { parse, body, response, ...rest } = options;
const messageValidator = getSchemaValidator(body, { ... });
```

So this works:

```ts
app.ws('/ws', {
  body: t.Object({
    type: t.String(),
    data: t.Unknown(),
  }),
  message(ws, msg) {
    // msg is typed: { type: string, data: unknown }
    switch (msg.type) {
      case 'conversation:join': /* ws.subscribe(`conv:${msg.data.id}`) */ break;
      // ...
    }
  },
});
```

Validation failures are emitted as `ValidationError` and either forwarded to the
WS `error` handler or sent verbatim to the client (`bun/index.mjs:317-326`).

---

## 8. Backpressure

**Source:** `node_modules/elysia/dist/ws/bun.d.ts:1-22, 339-383`

```ts
export type ServerWebSocketSendStatus = number;
//  0  => message dropped
// -1  => backpressure applied
// >0  => bytes sent
```

`ws.send(...)` and `ws.publish(...)` return that status. To detect saturation
and pause producers, check `=== -1`.

The `drain` callback is fired by Bun when a previously back-pressured
connection is ready again (`ws/bun.d.ts:339-343`, `ws/types.d.ts:12`):

```ts
app.ws('/ws', {
  drain(ws) { /* resume sends queued for ws.data.id */ },
});
```

Related limits on the WS config (`ws/bun.d.ts:371-383`):

- `maxPayloadLength` (default 16 MB)
- `backpressureLimit` (default 16 MB)
- `closeOnBackpressureLimit` (default `false`)

---

## 9. Closing connections

**Source:** `node_modules/elysia/dist/ws/index.d.ts:57` (re-exports
`ServerWebSocket['close']`), full signature at `ws/bun.d.ts:99-113`.

```ts
close(code?: number, reason?: string): void;
terminate(): void;   // bun.d.ts:119 — abrupt
```

Documented close codes (`ws/bun.d.ts:101-106`):
`1000` normal, `1009` too-big, `1011` server error, `1012` restarting,
`1013` busy/rate-limited, `4000-4999` app-defined.

**Forced-logout pattern (per `forcedLogoutAt`):** maintain an in-process
`Map<employeeId, Set<ElysiaWS>>` populated in `open` and pruned in `close`.
When `forcedLogoutAt` is bumped:

```ts
for (const ws of liveSockets.get(empId) ?? []) {
  ws.send(JSON.stringify({ type: 'auth:forceLogout' }));
  ws.close(4001, 'FORCE_LOGOUT'); // app-defined code in the 4000-4999 range
}
```

`server.publish` cannot close — it only sends — so closes must go through the
per-socket reference. This means **forced logout is single-instance only** until
the v2 redis fix (§11).

---

## 10. Heartbeat / ping

**Source:** `node_modules/elysia/dist/ws/bun.d.ts:398-402`

```ts
/** Should the server automatically send and respond to pings to clients?
 *  Default is `true`. */
sendPings?: boolean;
```

Plus `idleTimeout` (`ws/bun.d.ts:386-390`, default 120s; **Elysia overrides to
30s** at `adapter/bun/index.mjs:167, 180`).

**Bun auto-pings by default**, so no manual heartbeat is required on the server
side. The browser `WebSocket` API exposes neither `ping` nor `pong` events to
JS, so the client cannot send WS-protocol pings — apps that need app-layer
liveness should send `{ type: 'ping' }` JSON frames on a timer. The default
Bun/Elysia behavior (auto-ping + 30s idle close) is sufficient for the HRMS
chat/presence use case.

`ping`/`pong` hook keys exist (`ws/types.d.ts:18-19`) for observability.

---

## 11. Multi-instance limitation

The in-memory presence map (`Map<employeeId, ElysiaWS>`) and `app.server.publish`
**only fan out within a single Bun process**. Bun's WS topics are local to the
process — there is no built-in cross-node pub/sub (search of `ws/bun.d.ts` and
`universal/server.d.ts` shows no clustered publish API; **VERIFIED** beyond
that absence).

For horizontal scale (PM2 cluster, multiple containers behind a load balancer),
the v2 fix is:

- Front the WS endpoint with sticky sessions on the LB (so the same client lands
  on the same node — required because subscriptions are node-local), AND
- Bridge cross-node fan-out through Redis pub/sub: each node subscribes to a
  Redis channel; when a controller calls `publishNotification(empId, payload)`,
  it `PUBLISH`es to redis, every node receives it, and each node calls its own
  `app.server.publish(topic, ...)` for clients connected locally.

Until that bridge exists, deploy this as a **single-instance** service.

---

## APIs allowed (final allow-list for the migration)

Per-socket (inside an `app.ws` handler, on the `ws` param):

- `ws.send(stringOrBuffer, compress?)` — send to this socket; serialize with
  `JSON.stringify` yourself.
- `ws.subscribe(topic)` / `ws.unsubscribe(topic)` / `ws.isSubscribed(topic)` /
  `ws.subscriptions`.
- `ws.publish(topic, data, compress?)` — broadcast to topic, **does not echo to
  self** unless `publishToSelf: true` is set on the WS config.
- `ws.close(code?, reason?)` / `ws.terminate()`.
- `ws.data` — typed per-connection state (persists across messages).
- `ws.id` — random per-connection id (set by Elysia, see `bun/index.mjs:293`).
- `ws.raw` — escape hatch to the underlying `ServerWebSocket`
  (`ws/index.d.ts:10`).

App-level (from anywhere with the Elysia instance):

- `app.server?.publish(topic, stringOrBuffer)` — cross-handler fan-out
  (HTTP → WS). Requires `app.listen()` to have completed.

Hook keys (see §1 table for full list and citations):
`open`, `message`, `close`, `drain`, `ping`, `pong`, `parse`, `transform`,
`beforeHandle`, `afterHandle`, `mapResponse`, `afterResponse`, `error`,
`upgrade`, `body`, `response`, `query`, `params`, `headers`, `detail`, `tags`.

---

## Socket.IO-isms that DO NOT exist

| Socket.IO                                | Elysia/Bun replacement                                                                 |
|------------------------------------------|----------------------------------------------------------------------------------------|
| `socket.handshake.auth`                  | Use `?token=...` query string; read in `beforeHandle({ query })` (§2).                |
| `io.to(room).emit(event, data)`          | `app.server.publish('topic', JSON.stringify({ type, data }))` (§6).                   |
| `socket.join(room)` / `socket.leave(room)` | `ws.subscribe('topic')` / `ws.unsubscribe('topic')` (§4).                            |
| `io.emit(event, data)` (global)          | No global broadcast helper — pick a well-known topic (e.g. `broadcast:all`) and require all clients to subscribe; then `app.server.publish('broadcast:all', ...)`. |
| `socket.volatile.emit(...)`              | No equivalent. Check `ws.send` return — `-1` = backpressure, `0` = dropped (§8). Drop on caller side if needed. |
| `emit(event, data, ackCallback)`         | No built-in ack callbacks. Implement a correlation-id pattern: client sends `{ type, cid, data }`, server replies with `{ type: '...:ack', cid, data }`. |
| `io.in(room).fetchSockets()`             | No remote-socket enumeration. Maintain an in-process `Map<topic, Set<ws>>` if you need this (single-instance only — see §11). |
| Multiple namespaces (`io.of('/chat')`)   | Use separate `app.ws('/chat', ...)` paths instead.                                    |
| Automatic JSON serialization on `emit`   | Wrap manually: `ws.send(JSON.stringify(payload))` (§5 **VERIFIED** for auto-stringify of raw `send`). |
| Built-in reconnection / retry            | Browser `WebSocket` has none; implement in the client (`useSocket.js` already retries — port that logic). |

---

## Confidence & gaps

**High confidence (read directly from types/runtime):**

- All hook keys in §1 and their parameter shapes.
- `beforeHandle` runs before `server.upgrade` (adapter runtime trace, §2).
- `ws.data` carries the full HTTP context plus generated `id` (§3).
- `subscribe`/`unsubscribe`/`publish` method names and signatures (§4).
- `publishToSelf` default `false` (§4).
- `server.publish(topic, data)` for cross-handler fan-out (§6).
- `body` schema is consumed and validated (§7).
- Send-status return codes `-1` / `0` / `>0` (§8).
- `close(code, reason)` signature and reserved 4000-4999 range (§9).
- `sendPings` default `true`; Elysia overrides `idleTimeout` to 30s (§10).

**VERIFIED / gaps:**

- Whether `ws.send(plainObject)` auto-`JSON.stringify`s. The `createHandleWSResponse`
  helper covers return values from `open`/`message`, but the `.d.ts` does not
  prose-document raw `ws.send(obj)` for non-string inputs. **Recommendation:
  always pass a string.**
- Order of `transform` vs `parse` vs `beforeHandle` for the *upgrade* path — only
  `beforeHandle` is explicitly invoked in `bun/index.mjs:271-274` before
  `server.upgrade`; `parse` runs per-message (`bun/index.mjs:316`,
  `createWSMessageParser`). The role of `transform`/`afterHandle`/`mapResponse`/
  `afterResponse` on the WS route is **VERIFIED** at runtime — they are typed
  but not visibly wired in the bun adapter trace I inspected.
- No global broadcast helper found; rely on convention-named topic.
- No native multi-process pub/sub; §11 reflects this gap.
