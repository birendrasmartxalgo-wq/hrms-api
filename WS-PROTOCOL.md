# WebSocket Protocol Reference — HRMS API v1

> **Single source of truth** for web and mobile clients.  
> Endpoint: `ws[s]://<host>/api/v1/socket?token=<accessJwt>`

---

## Connection

### URL

```
ws://<host>/api/v1/socket?token=<accessJwt>
```

- `token` — a valid access JWT obtained from `POST /api/v1/auth/login` or `POST /api/v1/auth/refresh`.
- On failure (invalid / expired token) the server responds with **HTTP 401** and the upgrade is aborted — no WebSocket connection is established.

### Reconnection

The browser `WebSocket` API has no built-in reconnection. Clients **must** implement exponential-backoff reconnect on `close` / `error` events. Refresh the access token before reconnecting if the previous close reason was `4001 FORCE_LOGOUT`.

---

## Wire Format

Every frame in **both** directions is a **JSON string** matching:

```json
{ "type": "<event-name>", "data": { ... } }
```

- `type` — exact event name (see catalogues below).
- `data` — event-specific payload; always an object even if empty (`{}`).

> **Never send raw binary frames.** All payload must be UTF-8 JSON.

---

## Presence Events (server → client)

| Event | Topic | Payload |
|-------|-------|---------|
| `user:online` | `user:<empId>` | `{ employeeId }` |
| `user:offline` | `user:<empId>` | `{ employeeId }` |

Published on the personal room of the employee who just connected / disconnected.  
`user:online` is published only when the **first** tab opens (multiple tabs = one online event).  
`user:offline` is published only when the **last** tab closes.

---

## Client → Server Events

Send frames to the server using:

```js
ws.send(JSON.stringify({ type: '<event>', data: { ... } }));
```

### `conversation:join`

Subscribe to a conversation room to receive real-time events.

```json
{ "type": "conversation:join", "data": { "conversationId": "<id>" } }
```

> **Important:** Call this after the REST `GET /api/v1/chat/:id` succeeds (i.e. when you know the user is a participant). The server does not re-validate membership here.

---

### `conversation:leave`

```json
{ "type": "conversation:leave", "data": { "conversationId": "<id>" } }
```

---

### `typing:start` / `typing:stop`

```json
{ "type": "typing:start", "data": { "conversationId": "<id>" } }
{ "type": "typing:stop",  "data": { "conversationId": "<id>" } }
```

Server re-broadcasts to `conv:<id>` with the sender's `employeeId` injected:

```json
{
  "type": "typing:start",
  "data": { "conversationId": "<id>", "employeeId": "<sender-empId>" }
}
```

---

### `message:send`

```json
{
  "type": "message:send",
  "data": {
    "tempId": "client-uuid-v4",
    "conversationId": "<id>",
    "text": "Hello world",
    "type": "text",
    "file": {
      "fileName": "photo.jpg",
      "fileUrl": "https://...",
      "fileSize": 102400,
      "mimeType": "image/jpeg"
    },
    "replyTo": "<messageId>"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `tempId` | yes | Client-assigned temporary ID for optimistic UI; echoed in `message:sent`. |
| `conversationId` | yes | Target conversation. |
| `text` | no | Message text. |
| `type` | no | `"text"` (default) \| `"file"` \| `"image"`. |
| `file` | no | File metadata; required when `type` is `"file"` or `"image"`. Upload the file first via `POST /api/v1/uploads/sign`. |
| `replyTo` | no | MessageId of the quoted message. |

**Server responses:**

1. **`message:sent`** — back to sender only:
   ```json
   {
     "type": "message:sent",
     "data": {
       "tempId": "client-uuid-v4",
       "message": { "_id": "<id>", "conversation": "...", "sender": "...", "text": "...", "type": "text", "readBy": ["<empId>"], "createdAt": "..." }
     }
   }
   ```

2. **`message:new`** — broadcast to `conv:<id>` AND each participant's `user:<empId>`:
   ```json
   {
     "type": "message:new",
     "data": {
       "message": { "_id": "...", "conversation": "...", "sender": "...", "text": "...", "type": "text", "readBy": ["<senderEmpId>"], "createdAt": "..." }
     }
   }
   ```

3. **`message:error`** — back to sender on failure:
   ```json
   { "type": "message:error", "data": { "tempId": "...", "code": "DB_ERROR", "message": "..." } }
   ```

---

### `message:read`

```json
{
  "type": "message:read",
  "data": { "messageId": "<id>", "conversationId": "<id>" }
}
```

**Server broadcasts to `conv:<id>`:**

1. **`message:read`**
   ```json
   { "type": "message:read", "data": { "messageId": "...", "conversationId": "...", "readBy": "<empId>" } }
   ```

2. **`message:seenBy`**
   ```json
   {
     "type": "message:seenBy",
     "data": {
       "messageId": "...",
       "conversationId": "...",
       "reader": { "_id": "...", "empId": "...", "name": "...", "avatar": "..." }
     }
   }
   ```

---

## Server → Client Events (summary)

| Event | Recipient topic | Description |
|-------|----------------|-------------|
| `user:online` | `user:<empId>` | Employee connected |
| `user:offline` | `user:<empId>` | Employee disconnected |
| `typing:start` | `conv:<id>` | Typing indicator started |
| `typing:stop` | `conv:<id>` | Typing indicator stopped |
| `message:new` | `conv:<id>` + `user:<empId>` | New message (all participants) |
| `message:sent` | sender only | Confirmation with persisted message |
| `message:error` | sender only | Failure report |
| `message:read` | `conv:<id>` | Read receipt |
| `message:seenBy` | `conv:<id>` | Read receipt + reader profile |
| `notification:new` | `user:<empId>` | System notification |
| `error` | sender only | Unknown event type |

---

## Notifications

The server pushes `notification:new` to `user:<empId>` whenever a notification is created via `notifyEmployee()`. This happens from REST endpoints (leave approval, task assignment, etc.) using `app.server?.publish(...)`.

```json
{
  "type": "notification:new",
  "data": {
    "_id": "...",
    "employee": "<empId>",
    "title": "Your leave has been approved",
    "body": "Annual Leave for 3 days starting 2026-06-01",
    "type": "leave",
    "link": "/leaves/my",
    "read": false,
    "createdAt": "2026-05-12T10:00:00.000Z"
  }
}
```

---

## Missed Events / Offline Delivery

**There is no message queue in this phase.** A client that was offline will not receive events that occurred while disconnected.

Recovery strategies:

| Event type | Recovery |
|------------|----------|
| Chat messages | `GET /api/v1/chat/:id/messages?since=<isoTimestamp>` on reconnect to fetch messages newer than the last received timestamp. |
| Notifications | `GET /api/v1/notifications` on reconnect; returns last 50 unread, sorted by `createdAt DESC`. Notifications are persisted to DB before publishing (so they survive disconnection). |
| Presence / typing | No recovery; these are ephemeral. |

> **Durable delivery for chat messages** requires a DB-backed read-position and a background flush — planned for a future phase.

---

## Close Codes

| Code | Meaning |
|------|---------|
| 1000 | Normal closure |
| 1001 | Server going away (restart) |
| 1011 | Server error |
| 4001 | `FORCE_LOGOUT` — administrator invalidated the session; client should clear tokens and redirect to login |

---

## Multi-instance Limitation

The in-memory presence map and Bun's pub/sub topics are **single-process only**. Running multiple API containers behind a load balancer requires:

1. **Sticky sessions** on the load balancer (so each client always lands on the same node).
2. A **Redis pub/sub bridge**: each container subscribes to a Redis channel; `notifyEmployee` / `notifyAll` publish to Redis; each node receives the Redis message and calls `app.server?.publish(topic, ...)` for its locally-subscribed clients.

Until that bridge exists, deploy the API as a **single instance**.

---

## Pub/sub Topic Reference

| Topic pattern | Subscribers | Events published |
|---------------|-------------|-----------------|
| `user:<employeeId>` | Personal — one employee | `user:online`, `user:offline`, `message:new` (fan-out), `notification:new` |
| `conv:<conversationId>` | All joined participants | `typing:start`, `typing:stop`, `message:new`, `message:read`, `message:seenBy` |
