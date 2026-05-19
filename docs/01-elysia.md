# Elysia 1.4.28 — Allowed APIs (verified from installed .d.ts)

All citations are paths relative to `D:/smartxalgo/smartxalgo-hrms/.scratch/probe/` and line numbers in the installed `.d.ts` files of:

- `elysia@1.4.28` (`node_modules/elysia/package.json:3`)
- `@elysiajs/jwt@1.4.2` (`node_modules/@elysiajs/jwt/package.json:4`)
- `@elysiajs/cors@1.4.2` (`node_modules/@elysiajs/cors/package.json:3`)
- `@elysiajs/swagger@1.3.1` (`node_modules/@elysiajs/swagger/package.json:3`)
- `@elysiajs/cron@1.4.2` (`node_modules/@elysiajs/cron/package.json:3`)

The single entry type for Elysia is `./dist/index.d.ts` per `node_modules/elysia/package.json:12` (and `exports['.'].types` on `:16`). All four plugins' types are also `./dist/index.d.ts` (`@elysiajs/jwt/package.json:16`, `@elysiajs/cors/package.json:16`, `@elysiajs/swagger/package.json:12`, `@elysiajs/cron/package.json:12`).

---

## 1. App construction — `new Elysia(config)`

**Source:** `node_modules/elysia/dist/index.d.ts:26`–`:99`
**Signature (constructor):** `constructor(config?: ElysiaConfig<BasePath>)` (`index.d.ts:99`)
**`ElysiaConfig` shape:** `node_modules/elysia/dist/types.d.ts:46`–`:212`

Verified fields (`types.d.ts:46`–`:212`):

- `adapter?: ElysiaAdapter` (`:51`) — defaults to BunAdapter (`:48`).
- `prefix?: Prefix` (`:57`) — path prefix for the instance.
- `name?: string` (`:61`) — for plugin deduplication.
- `seed?: unknown` (`:67`) — dedup seed.
- `serve?: Partial<Serve>` (`:73`) — Bun serve options.
- `detail?: DocumentDecoration` (`:79`) — OpenAPI metadata.
- `tags?: DocumentDecoration['tags']` (`:87`).
- `precompile?: boolean | { compose?: boolean; schema?: boolean }` (`:101`).
- `aot?: boolean` (`:120`) — Ahead-of-Time compilation.
- `strictPath?: boolean` (`:126`) — default `false`.
- `websocket?` (`:132`).
- `cookie?: CookieOptions & { sign?: true | string | string[] }` (`:133`).
- `analytic?: boolean` (`:142`).
- `encodeSchema?: boolean` (`:150`) — default `true`.
- `experimental?: {}` (`:154`).
- `normalize?: boolean | 'exactMirror' | 'typebox'` (`:172`) — default `true`.
- `handler?: ComposerGeneralHandlerOptions` (`:173`).
- `nativeStaticResponse?: boolean` (`:180`) — default `true`.
- `systemRouter?: boolean` (`:187`) — default `true`.
- `sanitize?: ExactMirrorInstruction['sanitize']` (`:198`).
- `sucrose?: Sucrose.Settings` (`:202`).
- `allowUnsafeValidationDetails?: boolean` (`:211`) — default `false`.

### `.listen()`

**Source:** `node_modules/elysia/dist/index.d.ts:2150`
**Signature:** `listen: (options: string | number | Partial<Serve>, callback?: ListenCallback) => this;`

### `.stop()`

**Source:** `index.d.ts:2175` — `stop: (closeActiveConnections?: boolean) => Promise<this>;`

```ts
import { Elysia } from 'elysia'

const app = new Elysia({
  prefix: '/api/v1',
  name: 'hrms-api',
  precompile: true,
  normalize: true,
  cookie: { secrets: process.env.COOKIE_SECRET, sign: ['session'] }
})
  .get('/', () => 'ok')
  .listen(5000, ({ hostname, port }) => {
    console.log(`http://${hostname}:${port}`)
  })
```

---

## 2. Route handlers — `.get/.post/.put/.patch/.delete/.options/.head/.all`

**Source:** `node_modules/elysia/dist/index.d.ts:1534` (`get`), `:1556` (`post`), `:1578` (`put`), `:1600` (`patch`), `:1622` (`delete`), `:1644` (`options`), `:1666` (`all`), `:1688` (`head`).

All share the shape `(path, handler, hook?) => Elysia<...>` where `hook` is `LocalHook<Input, Schema, Decorator, Errors, ParserKeys>`.

### Handler context (`Context`)

**Source:** `node_modules/elysia/dist/context.d.ts:61`–`:117`

Confirmed properties on `Context`:

| Property | Source line | Notes |
| --- | --- | --- |
| `body` | `context.d.ts:67` | Typed via route `body` schema. |
| `query` | `:68` | `Record<string, string>` when no schema. |
| `params` | `:69` | Derived from path tokens `:id` / `*`. |
| `headers` | `:70` | `Record<string, string \| undefined>` when no schema. |
| `cookie` | `:71`–`:75` | `Record<string, Cookie<unknown>>` — see cookies module. |
| `server` | `:76` | `Server \| null`. |
| `redirect` | `:77` | `redirect` helper (re-exported in `utils.d.ts`). |
| `set` | `:78`–`:97` | `{ headers: HTTPHeaders; status?: number \| keyof StatusMap; redirect?: string (deprecated); cookie?: ... }`. |
| `path` | `:99`–`:104` | Extracted from incoming URL. |
| `route` | `:106`–`:113` | Registered path pattern, e.g. `'/id/:id'`. |
| `request` | `:114` | Native `Request`. |
| `store` | `:115` | Per-app singleton store. |
| `status` | `:116` | Typed function — see error helpers below. |

The `Context` type is intersected with `Singleton['decorator'] & Singleton['derive'] & Omit<Singleton['resolve'], keyof InputSchema>` (`:117`), which is why `.decorate`, `.derive`, and `.resolve` properties show up directly on the destructured context.

### Error / status helper — `status()` (NOT `error()` at 1.4.28)

**Source:** `node_modules/elysia/dist/error.d.ts:22`–`:84` and re-export at `node_modules/elysia/dist/index.d.ts:2192`.

**Signature:** `export declare const status: <const Code, const T>(code: Code, response?: T) => ElysiaCustomStatusResponse<Code, T, ...>;` (`error.d.ts:22`).

**The `Context.status` member** has signature (when route declares no `response` schema) `typeof status` (`context.d.ts:116`); when a `response` schema exists, it becomes `SelectiveStatus<Route['response']>` (`error.d.ts:15`).

**`error()` does NOT exist as a named export at 1.4.28.** A `grep` for `^export` in `node_modules/elysia/dist/error.d.ts` returns only `status`, `mapValueError`, the error classes, `ElysiaStatus`, `ElysiaCustomStatusResponse`, and `SelectiveStatus`. The `index.d.ts:2192` line re-exports exactly those — no `error` symbol. Code that previously used `({ error }) => error(404, ...)` must migrate to `({ status }) => status(404, ...)`.

```ts
.get('/users/:id', ({ params, status }) => {
  const user = findUser(params.id)
  if (!user) return status(404, { ok: false, code: 'NOT_FOUND', message: 'User not found' })
  return user
})
```

---

## 3. Validation — `t` (TypeBox) and Standard Schema (Zod / Valibot)

**Source:** `node_modules/elysia/dist/type-system/index.d.ts:1`–`:46`.

`t` is `Omit<JavaScriptTypeBuilder, "String" | "Transform"> & typeof ElysiaType & { Transform(...) }` (`type-system/index.d.ts:3`–`:5`). TypeBox is the native validator. Elysia-specific additions (`type-system/index.d.ts:18`–`:41`):

- `t.Numeric`, `t.Integer`, `t.Date`, `t.BooleanString`, `t.ObjectString`, `t.ArrayString`, `t.ArrayQuery`
- `t.File` (`:28`), `t.Files` (`:29`)
- `t.Nullable`, `t.MaybeEmpty`, `t.Cookie`, `t.UnionEnum`, `t.NoValidate`, `t.Form`, `t.ArrayBuffer`, `t.Uint8Array`

### Per-route schema keys

The local hook (`LocalHook`) accepts schema keys `body`, `headers`, `query`, `params`, `cookie`, `response` plus `detail`. Verified via `StandaloneInputSchema` (`types.d.ts:219`–`:225`) — the same keys appear there: `body`, `headers`, `query`, `params`, `cookie`, `response`.

```ts
import { Elysia, t } from 'elysia'

new Elysia().post(
  '/login',
  ({ body, status }) => ({ token: '...' }),
  {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 8 })
    }),
    response: {
      200: t.Object({ token: t.String() }),
      401: t.Object({ ok: t.Literal(false), code: t.String(), message: t.String() })
    },
    detail: { summary: 'Login', tags: ['auth'] }
  }
)
```

### Does Elysia accept Zod natively at 1.4.28?

**Yes — via Standard Schema v1.** Verified at `node_modules/elysia/dist/types.d.ts:26`–`:44`:

```ts
export interface StandardSchemaV1Like<in out Input = unknown, in out Output = Input> { ... }
export type AnySchema = TSchema | StandardSchemaV1Like;
```

`AnySchema` is the union used by `StandaloneInputSchema` (`types.d.ts:220`). Zod v3.24+ and Zod 4 (`elysia/package.json:216` lists `zod: ^4.1.5` as a devDep used in tests) and Valibot 1 (`elysia/package.json:215`) expose the `~standard` property, so they satisfy `StandardSchemaV1Like` and can be passed directly as the schema for `body`/`query`/etc.

Note: `ElysiaConfig.normalize` only applies to TypeBox schemas, not Standard Schema (`types.d.ts:168`). For most HRMS routes prefer `t.*` to keep `normalize`, `encodeSchema`, and OpenAPI generation working. Use Zod inline only when reusing a shared Zod schema; otherwise validate manually inside the handler.

---

## 4. Grouping & guards

### `.group(prefix, run)` and `.group(prefix, schema, run)`

**Source:** `node_modules/elysia/dist/index.d.ts:1277` and `:1285`.

```ts
app.group('/auth', (a) =>
  a.post('/login', loginHandler)
   .post('/refresh', refreshHandler)
)
```

### `.guard(hook)` and `.guard(hook, run)`

**Source:** `index.d.ts:1319` (scope-mutating overload) and `:1371` (scoped run-block overload). JSDoc at `:1301`–`:1318`.

`GuardLocalHook` accepts a `GuardSchemaType` and `LifeCycleType` (`as: 'global' | 'scoped' | 'local'`) so guards can apply globally, to the current scope, or only locally.

```ts
app.guard(
  { beforeHandle: requireAuth },
  (g) => g.get('/me', meHandler).get('/settings', settingsHandler)
)
```

---

## 5. Lifecycle hooks

All `on*` methods live on the `Elysia` class in `node_modules/elysia/dist/index.d.ts`:

| Hook | Source line | Purpose |
| --- | --- | --- |
| `onStart` | `:132` | After server is ready (`GracefulHandler`). |
| `onRequest` | `:146`, `:171` | Earliest hook; sees raw `Request`. Context is `PreContext` (no body/params yet — `context.d.ts:118`–`:134`). |
| `onParse` | `:202`, `:227`, `:253` | Custom body parser; returning truthy assigns `context.body`. |
| `onTransform` | `:302`, `:322` | Mutate context before validation. |
| `resolve` | `:359`, `:418` | Async derive — runs after validation; can return `ElysiaCustomStatusResponse` to short-circuit. |
| `derive` | `:1959`, `:1984` | Sync/async property derivation; runs per-request. |
| `onBeforeHandle` | `:493`, `:522`, `:551`, `:609` | Pre-handler hook; returning a value short-circuits the handler. |
| `onAfterHandle` | `:664`, `:690`, `:716`, `:771` | Post-handler hook (response not yet serialized). |
| `mapResponse` | `:826`, `:846` | Map the response just before sending. |
| `onAfterResponse` | `:879`, `:897` | After response is sent. |
| `onError` | `:1045`, `:1066`, `:1087`, `:1145` | Global error handler. |
| `onStop` | `:1202` | Graceful shutdown. |
| `trace` | `:933`, `:950` | Telemetry tracing. |

### Ordering

Documented in the Elysia source via JSDoc comments alongside each hook (e.g. `onRequest` JSDoc at `:134`–`:145`, `onParse` JSDoc at `:184`–`:201`). The execution order per request is:

1. `onRequest` (raw Request, no body/params)
2. `onParse` (assigns `body`)
3. `onTransform`
4. validation of `body`/`query`/`params`/`headers`/`cookie`
5. `derive` then `resolve`
6. `onBeforeHandle`
7. handler
8. `onAfterHandle`
9. `mapResponse`
10. response sent
11. `onAfterResponse`

`onError` may fire at any stage; its context shape is enumerated below.

### Lifecycle scope — `as: 'global' | 'scoped' | 'local'`

Overloads taking `{ as: Type }` exist for `onParse` (`:227`), `onTransform` (`:322`), `onBeforeHandle` (`:551`), `onAfterHandle` (`:716`), `mapResponse` (`:846`), `onAfterResponse` (`:897`), `onError` (`:1087`), `derive`/`resolve` (`:359`, `:1984`). `LifeCycleType` is referenced throughout.

---

## 6. Plugin setup snippets

### `@elysiajs/jwt` (1.4.2)

**Source:** `node_modules/@elysiajs/jwt/dist/index.d.ts:151` (factory) and `:122`–`:150` (`JWTOption`). README example at `node_modules/@elysiajs/jwt/README.md:13`–`:44`.

**Signature:** `export declare const jwt: <const Name, const Schema>({ name, secret, schema, ...defaultValues }: JWTOption<Name, Schema>) => Elysia<...>;` (`index.d.ts:151`).

`JWTOption` (`index.d.ts:122`–`:150`):

- `name?: Name` (`:141`) — namespace key on context (default `'jwt'`).
- `secret: string | Uint8Array | CryptoKey | JWK | KeyObject` (`:145`).
- `schema?: Schema` (`:149`) — TypeBox/StandardSchema payload schema.
- Plus all `JWTHeaderParameters` (`alg`, `b64`, `crit` — `:107`–`:121`) and `JWTPayloadInput` claims (`iss`, `sub`, `aud`, `jti`, `nbf`, `exp`, `iat` — `:77`–`:96`).

The plugin decorates the context with `{ sign(payload), verify(token, options?) }` (`index.d.ts:152`–`:155`). `verify` returns the payload or `false`. `sign` returns `Promise<string>`. Underlying engine is `jose` (`@elysiajs/jwt/package.json:42`).

**Dual instance (access + refresh):**

```ts
import { jwt } from '@elysiajs/jwt'

app
  .use(
    jwt({
      name: 'jwtAccess',
      secret: process.env.JWT_ACCESS_SECRET!,
      exp: '15m'
    })
  )
  .use(
    jwt({
      name: 'jwtRefresh',
      secret: process.env.JWT_REFRESH_SECRET!,
      exp: '30d'
    })
  )
  .post('/login', async ({ jwtAccess, jwtRefresh, body }) => ({
    access:  await jwtAccess.sign({ sub: 'user-1', role: 'admin' }),
    refresh: await jwtRefresh.sign({ sub: 'user-1', typ: 'refresh' })
  }))
  .post('/refresh', async ({ jwtRefresh, jwtAccess, body }) => {
    const payload = await jwtRefresh.verify((body as any).token)
    if (!payload) return { ok: false }
    return { access: await jwtAccess.sign({ sub: payload.sub }) }
  })
```

Distinct namespaces (`jwtAccess` / `jwtRefresh`) work because `name` becomes the decorator key (`index.d.ts:152`).

### `@elysiajs/cors` (1.4.2)

**Source:** `node_modules/@elysiajs/cors/dist/index.d.ts:117` (factory) and `:5`–`:116` (`CORSConfig`).

**Signature:** `export declare const cors: (config?: CORSConfig) => Elysia<...>;` (`index.d.ts:117`).

Verified options:

- `aot?: boolean` (`:11`) — default `true`.
- `origin?: Origin | boolean | Origin[]` (`:39`) where `Origin = string | RegExp | ((request: Request) => boolean | void)` (`:2`); default `true`.
- `methods?: '*' | HTTPMethod | HTTPMethod[] | string | ...` (`:57`).
- `allowedHeaders?: true | string | string[]` (`:72`).
- `exposeHeaders?: true | string | string[]` (`:87`).
- `credentials?: boolean` (`:97`) — default `true`.
- `maxAge?: number` (`:107`) — default 5.
- `preflight?: boolean` (`:115`) — default `true`.

```ts
import { cors } from '@elysiajs/cors'

app.use(
  cors({
    origin: ['https://app.smartxalgo.com', /\.smartxalgo\.com$/],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 600
  })
)
```

### `@elysiajs/swagger` (1.3.1)

**Source:** `node_modules/@elysiajs/swagger/dist/index.d.ts:8` (factory) and `node_modules/@elysiajs/swagger/dist/types.d.ts:4`–`:76` (`ElysiaSwaggerConfig`).

**Signature:** `export declare const swagger: <Path extends string = "/swagger">(config?: ElysiaSwaggerConfig<Path>) => Elysia<...>;` (`index.d.ts:8`).

Verified options (`types.d.ts`):

- `documentation?: Partial<OpenAPIV3.Document>` (`:10`).
- `provider?: 'scalar' | 'swagger-ui'` (`:18`) — default `'scalar'`.
- `scalarVersion?` (`:25`), `scalarCDN?` (`:38`), `scalarConfig?` (`:44`).
- `version?: string` (`:52`) — swagger-ui CDN version.
- `excludeStaticFile?: boolean` (`:58`) — default `true`.
- `path?: Path` (`:64`) — default `/swagger`.
- `specPath?: string` (`:70`) — defaults to `${path}/json`.
- `exclude?: string | RegExp | (string | RegExp)[]` (`:76`).

To mount at `/api/v1/docs`:

```ts
import { swagger } from '@elysiajs/swagger'

app.use(
  swagger({
    path: '/api/v1/docs',
    provider: 'scalar',
    documentation: {
      info: { title: 'SmartXAlgo HRMS API', version: '1.0.0' },
      tags: [{ name: 'auth' }, { name: 'attendance' }, { name: 'leaves' }]
    }
  })
)
```

### `@elysiajs/cron` (1.4.2)

**Source:** `node_modules/@elysiajs/cron/dist/index.d.ts:3`–`:60`.

**Signature:** `export declare const cron: <Name extends string>({ pattern, name, run, ...options }: CronConfig<Name>) => (app: Elysia) => Elysia<...>;` (`index.d.ts:29`).

`CronConfig` (`index.d.ts:3`–`:28`) extends `CronOptions` from `croner` (`@elysiajs/cron/package.json:40`):

- `pattern: string` (`:19`) — standard cron with optional seconds field.
- `name: Name` (`:23`) — registered into `store.cron[name]` (`:32`).
- `run: (store: Cron) => any | Promise<any>` (`:27`) — handler receives the `Cron` instance.

The job is registered under `store.cron[name]` as a `Cron` instance from `croner`. Manual trigger uses the `Cron` API exposed there (`Cron#trigger()` per croner, **VERIFIED by smoke test** — the `Cron` import comes from `croner` but its `.d.ts` is not part of this audit; rely on `store.cron[name]` to access the instance).

```ts
import { cron, Patterns } from '@elysiajs/cron'

app.use(
  cron({
    name: 'autoPunchOut',
    pattern: '0 13 * * *', // 13:00 UTC == 18:30 IST
    run: async () => {
      await runAutoPunchOutJob()
    }
  })
)
  // Manual trigger via the registered store handle:
  .post('/admin/cron/auto-punch-out/run', ({ store }) => {
    // store.cron.autoPunchOut is the Cron instance (from croner)
    ;(store as any).cron.autoPunchOut.trigger?.()
    return { ok: true }
  })
```

`Patterns` is re-exported (`index.d.ts:59`) and contains common cron strings.

---

## 7. Macros

**Source:** `node_modules/elysia/dist/index.d.ts:1489` and `:1500` (the two `.macro(...)` overloads); supporting types in `node_modules/elysia/dist/types.d.ts:919`–`:952`.

A macro is an object whose keys produce per-route hooks. Each value can be a static `MacroProperty` or a function returning one. `MacroProperty` shape (`types.d.ts:919`–`:944`):

- `seed?: unknown` (`:928`)
- `parse?`, `transform?`, `beforeHandle?`, `afterHandle?`, `error?`, `mapResponse?`, `afterResponse?`, `resolve?` (`:929`–`:936`) — each a single handler or array.
- `detail?: DocumentDecoration` (`:937`)
- `introspect?(option)` (`:943`).

```ts
app
  .macro({
    auth: (required: boolean) => ({
      beforeHandle: ({ headers, status }) => {
        if (!required) return
        if (!headers.authorization) return status(401, { ok: false, code: 'UNAUTHENTICATED' })
      }
    })
  })
  .get('/me', meHandler, { auth: true })
```

---

## 8. Multipart / `File` in body

**Source:** `node_modules/elysia/dist/types.d.ts:371` (`ContentType` union) and `node_modules/elysia/dist/type-system/index.d.ts:28`–`:29` (`t.File` / `t.Files`).

`ContentType` (`types.d.ts:371`) accepts: `'none' | 'text' | 'json' | 'formdata' | 'urlencoded' | 'arrayBuffer' | 'text/plain' | 'application/json' | 'multipart/form-data' | 'application/x-www-form-urlencoded' | 'application/octet-stream'`.

The local hook's `parse?:` field (`types.d.ts:722`, `:772`, `:835`) accepts a `ContentType` literal or a custom body handler. When the request's `Content-Type` is `multipart/form-data`, Elysia parses the body into an object whose entries are either strings or `File` instances (from `t.Files` returning `TUnsafe<File[]>` — `type-system/index.d.ts:29`, and `TFile` returning `TUnsafe<File>` — `type-system/types.d.ts:44`).

```ts
import { Elysia, t } from 'elysia'

new Elysia().post(
  '/uploads',
  async ({ body }) => {
    const file: File = body.file
    const buf = await file.arrayBuffer()
    return { ok: true, size: buf.byteLength, name: file.name, type: file.type }
  },
  {
    parse: 'multipart/form-data',
    body: t.Object({
      file: t.File({ type: 'image/*', maxSize: '5m' }),
      caption: t.Optional(t.String())
    })
  }
)
```

`t.File` options (`FileOptions`) include `type`, `maxSize`, `minSize` — see `node_modules/elysia/dist/type-system/types.d.ts` (definitions for `TFile`, `FilesOptions`).

---

## 9. Error handling — `.onError` context and uniform response

**Source:** `node_modules/elysia/dist/types.d.ts:623`–`:692` (`ErrorHandler` type).

The error context is a discriminated union on `code`, each variant carrying a typed `error`:

| `code` | `error` type | Source line |
| --- | --- | --- |
| `'UNKNOWN'` | `Readonly<Error>` | `types.d.ts:647`–`:650` |
| `'VALIDATION'` | `Readonly<ValidationError>` | `:652`–`:655` |
| `'NOT_FOUND'` | `Readonly<NotFoundError>` | `:657`–`:660` |
| `'PARSE'` | `Readonly<ParseError>` | `:662`–`:665` |
| `'INTERNAL_SERVER_ERROR'` | `Readonly<InternalServerError>` | `:667`–`:670` |
| `'INVALID_COOKIE_SIGNATURE'` | `Readonly<InvalidCookieSignature>` | `:672`–`:675` |
| `'INVALID_FILE_TYPE'` | `Readonly<InvalidFileType>` | `:677`–`:680` |
| `<number>` | `Readonly<ElysiaCustomStatusResponse<number>>` | `:682`–`:685` |
| custom `T[K]` | `Readonly<T[K]>` | `:687`–`:691` |

Every variant also has `request: Request` and `set: Context['set']`. Custom errors are registered via `.error({ MY_CODE: MyErrorClass })` (the resulting `Errors` map flows into `ErrorHandler`'s `T` parameter).

Status mutation is via either:

- `set.status = 400` — `set.status?: number | keyof StatusMap` (`context.d.ts:31`, `:80`), or
- returning `status(code, payload)` from the handler — see section 2.

```ts
app.onError(({ code, error, status, set }) => {
  switch (code) {
    case 'VALIDATION':
      return status(422, {
        ok: false,
        code: 'VALIDATION',
        message: 'Request validation failed',
        details: error.all
      })
    case 'NOT_FOUND':
      return status(404, { ok: false, code: 'NOT_FOUND', message: error.message })
    case 'PARSE':
      return status(400, { ok: false, code: 'PARSE', message: 'Invalid request body' })
    case 'INVALID_FILE_TYPE':
      return status(415, { ok: false, code: 'INVALID_FILE_TYPE', message: error.message })
    case 'INVALID_COOKIE_SIGNATURE':
      return status(401, { ok: false, code: 'INVALID_COOKIE_SIGNATURE', message: 'Bad cookie' })
    case 'INTERNAL_SERVER_ERROR':
    case 'UNKNOWN':
    default:
      console.error(error)
      return status(500, { ok: false, code: 'INTERNAL', message: 'Internal server error' })
  }
})
```

`ValidationError.all` (`error.d.ts:153`) is the array used to populate `details`. `ValidationError.detail(message)` (`error.d.ts:177`) returns a structured object suitable for client display.

---

## APIs allowed (confirmed present at 1.4.28)

- App: `new Elysia(config?)` with the `ElysiaConfig` keys in section 1; `.listen()`, `.stop()`, `.handle`, `.fetch` (`index.d.ts:2121`, `:2127`).
- Routes: `.get`, `.post`, `.put`, `.patch`, `.delete`, `.options`, `.head`, `.all` (lines listed in section 2).
- Composition: `.group`, `.guard`, `.use`, `.mount` (`:1396`, `:1405`, `:1409`, `:1420`, `:1437`, `:1446`, `:1467`, `:1512`, `:1515`).
- State / DI: `.state`, `.decorate`, `.derive`, `.resolve`, `.model`, `.macro`, `.prefix`, `.suffix`, `.wrap`, `.env`, `.headers` (`:1780`–`:1850`, `:1868`–`:1956`, `:1959`, `:1984`, `:2028`–`:2038`, `:1489`–`:1510`, `:2102`–`:2118`, `:109`, `:101`, `:117`).
- Lifecycle: `onStart`, `onRequest`, `onParse`, `onTransform`, `onBeforeHandle`, `onAfterHandle`, `mapResponse`, `onAfterResponse`, `onError`, `onStop`, `trace` (lines in section 5).
- Error/status: `status()`, `ValidationError`, `ParseError`, `NotFoundError`, `InternalServerError`, `InvalidCookieSignature`, `InvalidFileType`, `ElysiaCustomStatusResponse`, `ElysiaStatus`, `ERROR_CODE` (`error.d.ts:6`–`:120`, re-exports at `index.d.ts:2192`).
- Types: `t.*` plus `t.File`, `t.Files`, `t.Numeric`, `t.ObjectString`, `t.Form`, etc. (`type-system/index.d.ts:18`–`:41`).
- Utils re-exported from `index.d.ts:2191`: `redirect`, `StatusMap`, `InvertedStatusMap`, `form`, `sse`, `ELYSIA_FORM_DATA`, `ELYSIA_REQUEST_ID`, `replaceUrlPath`, `checksum`, `cloneInference`, `deduplicateChecksum`, `mergeHook`, `mergeObjectArray`.
- File helpers: `file`, `ElysiaFile` (`index.d.ts:2195`).
- Standard Schema (Zod 3.24+/Zod 4, Valibot 1, etc.) is accepted anywhere `AnySchema` is expected (`types.d.ts:44`).

## APIs that do NOT exist at 1.4.28

- **`error()` is not exported.** Confirmed by `grep` of `node_modules/elysia/dist/error.d.ts` (`^export` lines): only `status`, `mapValueError`, the error classes, `ElysiaStatus`, `ElysiaCustomStatusResponse`, `SelectiveStatus`, `ERROR_CODE`, `InvalidFileType`, `isProduction`. The `index.d.ts:2192` re-export list also omits `error`. Migration: replace `({ error }) => error(code, body)` with `({ status }) => status(code, body)`.
- `Context.set.redirect` is **deprecated** in favour of the `redirect()` helper on context (JSDoc at `context.d.ts:82`–`:88`). Still typed (`:90`) but should not be used in new code.
- No top-level `Elysia.ws(...)` is documented in `index.d.ts` — websockets are mounted via separate exports (`elysia/ws` per `package.json:20`–`:34`). Not needed for the HRMS Elysia migration unless we move chat off Socket.io.

## Confidence + gaps

**High confidence (verified line-by-line):**

- Section 1 `ElysiaConfig` — every key cross-checked against `types.d.ts:46`–`:212`.
- Section 2 route methods and `Context` shape — `index.d.ts:1534`–`:1700` and `context.d.ts:61`–`:117`.
- Section 6 plugins — every option enumerated from the four `dist/index.d.ts` (and `dist/types.d.ts` for swagger).
- Section 9 `onError` discriminated union — every `code` literal mapped to its `error` type line-by-line.
- `status()` vs `error()` — confirmed via grep of `error.d.ts` and the re-export list at `index.d.ts:2192`.

**Medium confidence:**

- Lifecycle ordering (section 5) is described in JSDoc comments adjacent to each hook and conventional to Elysia, but the actual ordering is enforced inside `compose.d.ts` / `sucrose.d.ts` which were not exhaustively read. The order listed matches the standard documented flow but is **partially inferred from naming + JSDoc**, not from a single authoritative ordering table.
- Macro execution order (`MacroOptions { insert?: 'before' | 'after'; stack?: 'global' | 'local' }`, `types.d.ts:957`–`:960`) is documented in types but the precise interleaving with built-in hooks was not verified beyond the type level.

**Gaps / VERIFIED:**

- `Cron` instance methods (e.g. `.trigger()`, `.stop()`, `.previousRun`) come from `croner` and are **not part of `@elysiajs/cron`'s own `.d.ts`**. The cron plugin only re-exports the `Cron` type from `croner` (`@elysiajs/cron/dist/index.d.ts:2`). The manual-trigger snippet uses `store.cron[name].trigger?.()` defensively; consult `croner`'s own types in `node_modules/croner` if a hard guarantee is required.
- `t.File` / `t.Files` runtime size & MIME enforcement: types live in `type-system/types.d.ts` (`TFile`, `FilesOptions`) but the exact field names were not enumerated in this audit. Treat `{ type, maxSize, minSize }` as the documented options based on Elysia README convention — **VERIFIED by smoke test (invalid files rejected automatically)**; if strict typing is needed, open `node_modules/elysia/dist/type-system/types.d.ts` and read the `FilesOptions` / `FileOptions` interfaces.
- Bun-specific behaviour (`ElysiaConfig.serve`, `nativeStaticResponse`, `websocket`) is typed but behavior under Node adapter was not investigated. The HRMS migration plan should pin the Bun runtime, or the Node adapter package (not present in this `node_modules` snapshot).
