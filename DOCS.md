# apps/api — Allowed APIs (Phase 0 reference)

This file is the **ground-truth catalog** of APIs used by `apps/api`. Every claim here is verified against installed `.d.ts` files at the pinned versions. Source-of-truth files live in `apps/api/docs/`.

**Probe install (the source for all citations):** `D:\smartxalgo\smartxalgo-hrms\.scratch\probe\node_modules\`

| Topic | File | Pinned version | Status |
|------|------|----------------|--------|
| Elysia core + plugins | [docs/01-elysia.md](docs/01-elysia.md) | elysia 1.4.28 / jwt 1.4.2 / cors 1.4.2 / swagger 1.3.1 / cron 1.4.2 | Verified (`.d.ts`) |
| Bun + mongodb + bcrypt | [docs/02-bun-mongodb.md](docs/02-bun-mongodb.md) | mongodb 7.2.0 / bcryptjs 3.0.3 / @node-rs/bcrypt 1.10.7 | Verified (`.d.ts`); Bun runtime UNVERIFIED |
| AWS S3 (SDK v3) + presigned URLs | [docs/03-s3.md](docs/03-s3.md) | @aws-sdk/client-s3 3.1045.0 / s3-request-presigner 3.1045.0 / lib-storage 3.1045.0 | Verified (`.d.ts`); Bun runtime UNVERIFIED |
| Eden Treaty | [docs/04-eden.md](docs/04-eden.md) | @elysiajs/eden 1.4.9 | Verified (`.d.ts`); RN FormData UNVERIFIED |
| Elysia WebSocket | [docs/05-elysia-ws.md](docs/05-elysia-ws.md) | elysia 1.4.28 (WS) | Verified (`.d.ts` + adapter trace) |

---

## Cross-cutting decisions (these change the migration plan)

### D1. Use `status(code, body)`, NOT `error(code, body)`
At elysia 1.4.28 the `error` helper is gone; the only helper exported is `status` (`error.d.ts:22`, re-exported `index.d.ts:2192`). Context member is `ctx.status`.

```ts
.get('/x', ({ status }) => status(404, { ok: false, code: 'NOT_FOUND' }))
.onError(({ code, error, status }) => status(500, { ok: false, code, message: String(error) }))
```

### D2. Zod is accepted natively via Standard Schema v1
`AnySchema = TSchema | StandardSchemaV1Like` (`types.d.ts:44`). We can pass Zod schemas as `body`/`params`/`query`/`response` directly. **But** `ElysiaConfig.normalize` only applies to TypeBox, so for swagger/OpenAPI generation TypeBox `t.*` is still preferred. **Plan:** use **TypeBox at the route edge** (for swagger), **Zod for internal service-layer DTOs and the `@hrms/contracts` package** (shared with web + mobile).

### D3. `findOneAndUpdate` return shape at mongodb 7.x
Returns `WithId<T> | null` by default (no `{ value, ok }` wrapper). Default `returnDocument` is `"before"` — must pass `returnDocument: 'after'` to mimic Mongoose `{ new: true }`. All service helpers in `apps/api/src/modules/*/service.ts` must use the new shape.

### D4. mongodb 7.x requires Node ≥ 20.19.0
Bun's Node-compat advertises Node 24 semantics so this is fine, but pinning it in `package.json` `engines` is wise.

### D5. bcrypt: use `bcryptjs`
Pure JS, no native build, works on Bun. Auth is not a hot path; the 18% perf gap to `@node-rs/bcrypt` doesn't justify the prebuild-target risk (musl, Alpine, multi-arch Docker).

### D6. Presigned PUT `Content-Type` is bound at sign time
If `PutObjectCommand` includes `ContentType`, the client **must** send the identical `Content-Type` header at upload time, or S3 returns `SignatureDoesNotMatch`. Lock this into the `/uploads/sign` response contract:
```ts
{ key, url, headers: { 'Content-Type': contentType } }  // client echoes headers verbatim
```

### D7. `s3:HeadObject` is not a real IAM action
HEAD is authorized via `s3:GetObject`. IAM policy is:
```
s3:PutObject, s3:GetObject, s3:DeleteObject, s3:AbortMultipartUpload
```
on `arn:aws:s3:::<bucket>/*` (trailing `/*` mandatory).

### D8. Eden Treaty does NOT strip the API prefix
With `new Elysia({ prefix: '/api/v1' })`, the consumer calls `api.api.v1.auth.login.post(...)`. Keep this in mind when designing the Eden client wrapper exposed from `packages/contracts`.

### D9. React Native FormData is NOT detected by Eden Treaty
Treaty switches to multipart only on `instanceof File` / `FileList`. RN's `{ uri, name, type }` objects don't match. **Decision:** on the mobile client, use **presigned PUT (D6) for all uploads**, bypassing Eden entirely for file bodies. JSON request afterwards posts the key. This actually aligns with the plan's "direct-to-S3 for mobile" track.

### D10. WS pub/sub: `ws.publish` excludes self; HTTP fan-out uses `app.server.publish`
- From a WS handler: `ws.publish(topic, data)` — excludes self. Use `ws.send` to echo to self.
- From an HTTP handler (e.g., notification fan-out): `app.server.publish(topic, JSON.stringify({ type, data }))` — reaches everyone subscribed. `app.server` is non-null after `app.listen()` (`adapter/bun/index.mjs:190`).
- Wire format is `{ type, data }` JSON — there's no Socket.IO-style event dispatch.
- Server auto-pings every 30s (Elysia overrides Bun's default `idleTimeout` to 30s). No manual heartbeat needed.

### D11. `error()` rename impacts copy-from-legacy
Legacy controllers will use Express's pattern `res.status(404).json(...)`. New code uses `status(404, ...)` returned directly. No need to keep both — every ported route uses `status()`.

---

## APIs allowed (canonical list)

**Elysia 1.4.28** — `new Elysia({...})`, `.get/.post/.put/.patch/.delete`, `.ws`, `.group`, `.guard`, `.use`, `.derive`, `.resolve`, `.onRequest`, `.onBeforeHandle`, `.onAfterHandle`, `.onAfterResponse`, `.mapResponse`, `.onError`, `.onTransform`, `.macro`, `.listen`, context: `body | query | params | headers | cookie | server | redirect | set | path | route | request | store | status`.

**TypeBox via `t`** — `t.Object`, `t.String`, `t.Number`, `t.Boolean`, `t.Array`, `t.Optional`, `t.Union`, `t.Literal`, `t.Date`, `t.File`, `t.Files`, `t.Nullable`, `t.Unknown`.

**`@elysiajs/jwt`** — factory `jwt({ name, secret, exp })`; `.sign(payload)`, `.verify(token)`.

**`@elysiajs/cors`** — `cors({ origin, credentials, methods, allowedHeaders, exposeHeaders, maxAge, preflight })`.

**`@elysiajs/swagger`** — `swagger({ path, documentation, exclude, ... })`.

**`@elysiajs/cron`** — `cron({ name, pattern, timezone, run, ... })`; `store.cron.<name>.trigger()` for manual fire (UNVERIFIED — defensive `?.`).

**Elysia WS** — `app.ws(path, opts)`; in-handler `ws.send`, `ws.publish`, `ws.subscribe`, `ws.unsubscribe`, `ws.close`, `ws.data`, `ws.id`; out-of-handler `app.server.publish`. Lifecycle: `open`, `message`, `close`, `drain`, `error`, `ping`, `pong`, plus HTTP-style hooks `parse | transform | beforeHandle | afterHandle | mapResponse | afterResponse | upgrade` and schemas `body | response | query | headers | params`.

**`mongodb` 7.2.0** — `MongoClient`, `Db.collection<T>`, `ObjectId`, `OptionalUnlessRequiredId<T>`, `WithId<T>`. CRUD: `findOne`, `find`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `findOneAndUpdate` (default returnDocument `"before"`), `deleteOne`, `countDocuments`, `distinct`, `aggregate`. Schema: `createIndex`, `createIndexes`. Tx: `client.withSession`, `session.withTransaction`.

**`@aws-sdk/client-s3` 3.1045.0** — `S3Client`, `PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`, `HeadObjectCommand`.

**`@aws-sdk/s3-request-presigner` 3.1045.0** — `getSignedUrl(client, command, { expiresIn })` (default 900s; upper bound UNVERIFIED but practically 7d for sigv4).

**`@aws-sdk/lib-storage` 3.1045.0** — `Upload` class (use only for >100MB; default `partSize` 5MB, `queueSize` 4, MAX_PARTS 10000).

**`@elysiajs/eden` 1.4.9** — `treaty<App>(domain, config?)` (Treaty 2 — use this), `edenFetch<App>(domain)`. Response: `{ data, error, response, status, headers }`. WS via property `subscribe()` → `EdenWS` with `.subscribe(fn)`, `.on(...)`, `.send(...)`, `.close()`.

**`bcryptjs` 3.0.3** — `hash(password, rounds)`, `compare(candidate, hash)`.

---

## APIs that do NOT exist (forbidden — will fail)

- **Elysia `error()`** — gone at 1.4.28. Use `status()`.
- **Mongoose-isms** — `.populate()`, `.save()`, `pre`/`post`/middleware, virtuals, `select: false`, `.lean()`, `Schema.Types.ObjectId`, schema-level `unique: true`, auto-timestamps, cast errors. We are on the native driver.
- **mongodb 6.x `findOneAndUpdate` `{ value, ok }` shape** — gone at 7.x.
- **`aws-sdk` v2** (`require('aws-sdk')`) — end-of-support 2025-09-08. SDK v3 only.
- **`s3:HeadObject` IAM action** — not a real action.
- **Socket.IO surface** — `socket.handshake.auth`, `io.to(room).emit(event, data)`, `socket.join(room)`, volatile emits, ack callbacks. Use Elysia WS pub/sub + `{ type, data }` wire format.
- **Eden Treaty `.json()`** — there is no `.json()`; use the `data` property of the result.
- **Streaming responses in React Native fetch** — not supported by Hermes. For PDF downloads on mobile, use signed S3 GET URL + `expo-file-system.downloadAsync`.

---

## Phase 0 verification (this section is the checklist)

- [x] `apps/api/docs/01-elysia.md` exists
- [x] `apps/api/docs/02-bun-mongodb.md` exists
- [x] `apps/api/docs/03-s3.md` exists
- [x] `apps/api/docs/04-eden.md` exists
- [x] `apps/api/docs/05-elysia-ws.md` exists
- [x] Each doc cites file:line for verified claims
- [x] Each doc has an "APIs allowed" + "APIs NOT to use" list
- [x] Each doc flags UNVERIFIED items explicitly
- [x] DOCS.md consolidates cross-cutting decisions (D1–D11)

## Phase 2 Smoke-Test Results (All Items VERIFIED)

1. `mongodb` 7.2.0 driver on Bun: **VERIFIED**. Connect + CRUD + transaction tests pass using `mongodb-memory-server` and native MongoClient logic.
2. `@aws-sdk/client-s3` 3.1045.0 on Bun: **VERIFIED**. `getSignedUrl` correctly handles 7-day TTLs (`604800` seconds) and `PutObjectCommand` is fully compatible.
3. Cron `Cron#trigger()` from `@elysiajs/cron`: **VERIFIED**. Manual job firing via `app.store.cron[name].trigger?.()` works as expected.
4. Elysia `body` schema validation on `app.ws`: **VERIFIED**. Elysia correctly emits a JSON validation error frame and closes the connection. It also auto-stringifies responses sent through `ws.send`.
5. Elysia `t.File` runtime MIME validation: **VERIFIED**. The schema correctly rejects mismatched MIME types.
6. React Native FormData → Eden Treaty multipart: N/A (we're using presigned PUT instead per D9).
7. Eden Treaty type inference across workspace boundary: **VERIFIED**. Type-safety translates correctly when importing `App` across boundaries.

---

## Phase 3: DB Types & Indexes

With Mongoose removed, the patterns for typing MongoDB collections, adding Zod validation for inserts/updates, and explicitly declaring indexes have been established.

Please refer to the ground-truth documentation for Phase 3 implementation:
- **[docs/06-db-types.md](docs/06-db-types.md)** — Patterns for `interface`, schemas, collection access, and `ensureIndexes`.
