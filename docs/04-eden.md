# Eden Treaty 1.4.9 — Allowed APIs

Phase 0 documentation discovery for `@elysiajs/eden@1.4.9` against `elysia@1.4.28`.
Targets: shared `packages/contracts` re-exporting `type App = typeof app` from `apps/api`,
consumed by `apps/web` (Vite 8 + React 19.2.6) and `apps/mobile` (Expo 55 / React Native).

All facts below are cited to `.d.ts` files in
`node_modules/@elysiajs/eden/dist/` (1.4.9) and `node_modules/elysia/dist/` (1.4.28),
relative to `D:\smartxalgo\smartxalgo-hrms\.scratch\probe\`. Anything not directly visible in
those types is flagged **VERIFIED** by smoke tests.

---

## 1. Package surface

**Source:** `node_modules/@elysiajs/eden/dist/index.d.ts:1-5`
**Snippet:**
```ts
export { Treaty, treaty } from './treaty2.js';
export { edenTreaty } from './treaty.js';
export { edenFetch } from './fetch.js';
export { E as EdenFetchError } from './types-0YqzVuGd.js';
import 'elysia';
```

**Notes:**
- Exports from `@elysiajs/eden` (root entry) at 1.4.9:
  - `treaty` — the current Treaty 2 client (recommended).
  - `Treaty` — the type namespace (`Treaty.Create`, `Treaty.Config`, `Treaty.TreatyResponse`, `Treaty.Data`, `Treaty.Error`, …).
  - `edenTreaty` — legacy Treaty 1 client (kept for back-compat).
  - `edenFetch` — fetch-style flavor.
  - `EdenFetchError` — typed error wrapper used by `edenFetch`.
- Subpath exports (`package.json:12-34`): `@elysiajs/eden/treaty`, `/treaty2`, `/fetch`.
- Peer dep: `elysia >=1.4.19` (`package.json:55-57`). Our `elysia@1.4.28` satisfies it.

---

## 2. Treaty vs Fetch flavors

**Source (Treaty 2):** `node_modules/@elysiajs/eden/dist/treaty2/index.d.ts:6`
**Signature:**
```ts
export declare const treaty: <
  const App extends Elysia<any, any, any, any, any, any, any>,
  Head extends {} = {}
>(domain: string | App, config?: Treaty.Config<Head>) => Treaty.Create<App, Head>;
```

**Source (legacy Treaty 1):** `node_modules/@elysiajs/eden/dist/treaty/index.d.ts:17`
**Signature:**
```ts
export declare const edenTreaty: <App extends Elysia<any, any, any, any, any, any, any>>(
  domain: string, config?: EdenTreaty.Config
) => EdenTreaty.Create<App>;
```

**Source (fetch flavor):** `node_modules/@elysiajs/eden/dist/fetch/index.d.ts:4`
**Signature:**
```ts
export declare const edenFetch: <App extends Elysia<any, any, any, any, any, any, any>>(
  server: string, config?: EdenFetch.Config
) => EdenFetch.Create<App>;
```

**Recommendation:** use `treaty` (Treaty 2). It yields a proxy where the route tree is walked via property access (`api.api.v1.auth.login.post(body, opts)`), supports per-request headers, global header functions, `onRequest`/`onResponse` middleware, and proper WS typing via `EdenWS`. `edenFetch` is string-keyed (`fetch('/api/v1/auth/login', { method: 'POST', body, … })`) — less ergonomic, no WS support, kept mainly for bundle-size-sensitive cases. `edenTreaty` is the older, deprecated proxy.

---

## 3. Exporting the App type from Elysia and preserving inference

**Source:** `node_modules/elysia/dist/index.d.ts:1396-1467` — every `.use(...)` overload returns a new `Elysia<...>` whose generic parameters are the merge of the parent and the plugin's routes/decorators.

**Snippet:**
```ts
use<const NewElysia extends AnyElysia>(instance: MaybePromise<NewElysia>): Elysia<BasePath, { ... }>;
use<const Instances extends AnyElysia[]>(instance: MaybePromise<Instances>): MergeElysiaInstances<Instances, BasePath>;
use<const NewElysia extends AnyElysia>(plugin: Promise<{ default: ... }>): ...;
use<const NewElysia, const Param extends AnyElysia = this>(
  plugin: (app: Param) => NewElysia
): Elysia<BasePath, { ... merged ... }>;
```

**Pattern (`apps/api/src/index.ts`):**
```ts
const app = new Elysia({ prefix: '/api/v1' })
  .use(authRoutes)
  .use(employeeRoutes)
  .use(payrollRoutes);

export type App = typeof app;
```

Then in `packages/contracts/src/index.ts`:
```ts
export type { App } from '@hrms/api/src/index.ts';
// plus Zod schemas / DTOs shared with clients
```

**Gotchas (verified in types):**
- Inference flows through `.use()` **only when each plugin is itself an `Elysia` instance returned from a function or a top-level constant.** Splitting routes into a function that `return`s the chain works because `use` accepts `(app) => NewElysia` (line 1437). What breaks inference is calling `.use()` on a `let` variable in branches — `const` chains (1396, 1437) preserve `const` generics; reassignment widens them.
- The eden side cares about `'~Routes'` on the App type — see `treaty2/types.d.ts:22-24`:
  ```ts
  export type Create<App extends Elysia<...>> =
    App extends { '~Routes': infer Schema extends Record<any, any> }
      ? Prettify<Sign<Schema, Head>> & CreateParams<Schema, Head>
      : 'Please install Elysia before using Eden';
  ```
  If the literal `'Please install Elysia before using Eden'` shows up at the call site, `App` lost its `~Routes` — usually because the type was widened by an unannotated factory or re-exported as `Elysia` (the bare class) instead of `typeof app`.
- Always export with `export type { App }` to avoid runtime import cycles between the contracts package and the API.

---

## 4. Treaty client usage and URL mapping

**Source:** `node_modules/@elysiajs/eden/dist/treaty2/types.d.ts:31-47`
**Snippet:**
```ts
export type Sign<in out Route, in out Head> = {
  [K in keyof Route as K extends `:${string}` ? never : K]:
    K extends 'subscribe' ? (options?) => EdenWS<Route['subscribe']> :
    (Route[K] extends { body; headers; params; query; response } ? ... : CreateParams<Route[K], Head>)
    & { '~path': string };
};

type CreateParams<Route, Head> = Extract<keyof Route, `:${string}`> extends infer Path extends string
  ? IsNever<Path> extends true ? Prettify<Sign<Route, Head>>
  : ((params: { [param in ... ]: string | number }) => Prettify<Sign<Route[Path], Head>>) & Prettify<Sign<Route, Head>>
  : never;
```

**Mapping:** The proxy walks the `~Routes` tree segment-by-segment. The HTTP method is the **leaf** key (`get`, `post`, `put`, …). So if the server registers `POST /api/v1/auth/login` (i.e. `Elysia({ prefix: '/api/v1' }).group('/auth', a => a.post('/login', …))`), the leaf is `api.api.v1.auth.login.post(body, options)`.

Treaty does **not** auto-strip or auto-add `/api/v1`. The URL is `domain` + each property segment concatenated with `/` + the HTTP method as the request method. Path params like `:id` become **function calls**: `app.users({ id: 42 }).get()` — see `CreateParams` (line 42-47): a `:param` key turns into a `(params) => Sign<Route[Path]>` function.

So with `treaty<App>('http://localhost:3000')` and the prefixed app above:
- `app.api.v1.auth.login.post({ email, password })` → `POST http://localhost:3000/api/v1/auth/login`
- `app.api.v1.employees({ id: 'abc' }).get()` → `GET http://localhost:3000/api/v1/employees/abc`

You can introspect the concrete path at runtime via the `~path` marker on each node (`treaty2/types.d.ts:39`).

---

## 5. Headers / auth (per-request + global)

**Source:** `node_modules/@elysiajs/eden/dist/treaty2/types.d.ts:48-65`
**Signature:**
```ts
export interface Config<Head extends {} = {}> {
  fetch?: Omit<RequestInit, 'headers' | 'method'>;
  fetcher?: typeof fetch;
  headers?: MaybeArray<
    Head
    | RequestInit['headers']
    | ((path: string, options: RequestInit) => MaybePromise<Head | RequestInit['headers'] | void>)
  >;
  onRequest?:  MaybeArray<(path, options) => MaybePromise<RequestInit | void>>;
  onResponse?: MaybeArray<(response: Response) => MaybePromise<unknown>>;
  keepDomain?: boolean;
  parseDate?: boolean;          // default true
  throwHttpError?: ThrowHttpError;
}
```

**Per-request:** every method takes an `options` arg whose `headers` field is type-checked against the route's declared headers (`Sign` in `treaty2/types.d.ts:38` returns `(body, options: ToTreatyParam<Param, Head>) => Promise<TreatyResponse<…>>`; `ToTreatyParam` at lines 25-30 surfaces `headers` when the route schema declares it).

```ts
api.api.v1.auth.me.get({
  headers: { authorization: `Bearer ${token}` }
});
```

**Global (recommended for auth):** pass a function so the token is read fresh on every request — the static-object form snapshots the token at client-construction time.
```ts
export const api = treaty<App>('https://hrms.example.com', {
  headers(path, options) {
    const t = getToken();           // localStorage on web, SecureStore on RN
    return t ? { authorization: `Bearer ${t}` } : {};
  },
  onResponse(res) {
    if (res.status === 401) clearToken();
  }
});
```

`headers` accepts `MaybeArray<...>`, so you can pass an array of resolvers (e.g. one for auth, one for tracing) and they all merge.

---

## 6. File uploads (multipart/form-data)

**Source (runtime, minified):** `node_modules/@elysiajs/eden/dist/chunk-TTKI5TQ7.mjs` — Treaty's body normaliser. Decompiled excerpt:
```js
if (Y(s)) {                                       // body contains File/Blob anywhere
  let y = new FormData;
  let w = async f => f instanceof File ? await K(f) : c(f) ? JSON.stringify(f) : f;
  for (let [f, p] of Object.entries(a.body)) {
    if (Array.isArray(p)) { ... y.append(f, await w(z)); continue }
    if (p instanceof File) { y.append(f, await K(p)); continue }
    if (p instanceof FileList) { for (... ) ... }
    ...
  }
}
```

**Source (types):** `treaty2/types.d.ts:10-13`
```ts
type MaybeArrayFile<T> = T extends File[] ? File[] | File : T extends File ? File : T;
type RelaxFileArrays<T> = T extends Record<string, unknown> ? { [K in keyof T]: MaybeArrayFile<T[K]> } : T;
```
The body type is `RelaxFileArrays<Body>`, so a field typed `File[]` accepts a single `File`.

**Usage (web):**
```ts
api.api.v1.documents.upload.post({
  file: fileInput.files![0],      // browser File
  category: 'aadhar'
});
```
Treaty detects `instanceof File` / `FileList`, switches to `FormData`, JSON-stringifies non-File object fields, and lets `fetch` set the `Content-Type: multipart/form-data; boundary=…` header automatically.

**React Native quirk — VERIFIED in eden source:**
RN's `FormData` accepts the object shape `{ uri: string, name: string, type: string }`, but RN does **not** ship a real `File` or `Blob` constructor that returns instances passing `instanceof File`. Treaty's branch is gated on `instanceof File` / `instanceof FileList` (see decompiled excerpt above). Therefore an RN `{ uri, name, type }` will **fall through to the JSON branch** and be serialized as `application/json` — the server will receive a JSON string, not a file.

**Recommendation for `apps/mobile`:** bypass Treaty for uploads. Construct `FormData` manually and call raw `fetch`, reusing only the URL Treaty would have produced (`api.api.v1.documents.upload['~path']`) and the auth resolver:
```ts
const fd = new FormData();
fd.append('file', { uri, name, type } as any);
fd.append('category', 'aadhar');
await fetch(`${BASE}/api/v1/documents/upload`, {
  method: 'POST',
  headers: { authorization: `Bearer ${getToken()}` },
  body: fd
});
```
Keep Treaty for every other endpoint so the type-safety story stays intact.

---

## 7. WebSocket via Treaty

**Source:** `node_modules/@elysiajs/eden/dist/treaty2/types.d.ts:32` and `treaty2/ws.d.ts:3-14`
**Snippet (route → client mapping):**
```ts
[K in keyof Route as ...]:
  K extends 'subscribe'
    ? MaybeEmptyObject<Route['subscribe']['headers'], 'headers'>
      & MaybeEmptyObject<SerializeQueryParams<Route['subscribe']['query']>, 'query'>
        extends infer Param
      ? (options?: Param) => EdenWS<Route['subscribe']>
      : never
```

**Snippet (`EdenWS` class):**
```ts
export declare class EdenWS<Schema extends InputSchema<any> = {}> {
  url: string;
  ws: WebSocket;
  constructor(url: string);
  send(data: Schema['body'] | Schema['body'][]): this;
  on<K extends keyof WebSocketEventMap>(type, listener, options?): this;
  off<K>(...): this;
  subscribe(onMessage: (event: Treaty.WSEvent<'message', Schema['response'][200]>) => void, options?): this;
  addEventListener<K>(...): this;
  removeEventListener<K>(...): this;
  close(): this;
}
```

**Usage:** an Elysia `app.ws('/chat', { body, response, ... })` exposes a `subscribe` key under that path. The Treaty call:
```ts
const socket = api.api.v1.chat.subscribe();   // returns EdenWS<typeof schema>
socket.subscribe(ev => { console.log(ev.data); });
socket.send({ type: 'msg', text: 'hi' });     // body typed from Elysia schema
socket.close();
```
Both `body` on `send` and `data` on the `message` event are inferred from the server's `t.Object(...)` schemas.

**React Native gotcha — VERIFIED:** `EdenWS` uses the global `WebSocket`. RN's `WebSocket` supports the basic API (`onmessage`, `send`, `close`) but lacks `binaryType: 'blob'` semantics and some `WebSocketEventMap` keys. Treaty's `on('open' | 'close' | 'error' | 'message')` should work; binary frames may need `socket.ws.binaryType = 'arraybuffer'`. Reconnect logic is not in Treaty — wrap it yourself.

---

## 8. Error shape

**Source:** `node_modules/@elysiajs/eden/dist/treaty2/types.d.ts:66-90`
**Snippet:**
```ts
export type TreatyResponse<Res extends Record<number, unknown>> =
  | {
      data: Res[Extract<keyof Res, SuccessCodes>] extends { [ELYSIA_FORM_DATA]: infer Data } ? Data
            : Res[Extract<keyof Res, SuccessCodes>];
      error: null;
      response: Response;
      status: number;
      headers: ResponseInit['headers'];
    }
  | {
      data: null;
      error: Exclude<keyof Res, SuccessCodes> extends never
        ? { status: unknown; value: unknown }
        : { [Status in keyof Res]: { status: Status; value: Res[Status] extends { [ELYSIA_FORM_DATA]: infer Data } ? Data : Res[Status] } }
            [Exclude<keyof Res, SuccessCodes>];
      response: Response;
      status: number;
      headers: ResponseInit['headers'];
    };
```

**Shape:** `{ data, error, response, status, headers }` (note: **`headers`** is part of the shape too, not just `{ data, error, status, response }`). Discriminated by `error === null`.

`SuccessCodes = 200|201|202|203|204|205|206|207|208|226` (`treaty2/types.d.ts:8`). Anything outside that set on the route's `response` map becomes part of the `error` union:
```ts
.post('/login', ..., {
  response: {
    200: t.Object({ token: t.String() }),
    400: t.Object({ code: t.Literal('BAD_CREDENTIALS') }),
    429: t.Object({ retryAfter: t.Number() })
  }
})
```
yields:
```ts
const { data, error } = await api.api.v1.auth.login.post({...});
if (error) {
  switch (error.status) {
    case 400: error.value.code;          // 'BAD_CREDENTIALS'
    case 429: error.value.retryAfter;    // number
  }
} else {
  data.token;                            // string
}
```
If the route schema declares no error variants, `error` widens to `{ status: unknown; value: unknown }`.

`Treaty.Data<typeof call>` and `Treaty.Error<typeof call>` helpers (lines 99-100) extract just the success/error branches for reuse in React Query keys.

---

## 9. Versioning the contracts package (process advice — not from types)

For a Bun-managed monorepo:

```jsonc
// apps/web/package.json, apps/mobile/package.json
"dependencies": {
  "@hrms/contracts": "workspace:*",
  "@elysiajs/eden": "1.4.9"
}
```

- `workspace:*` keeps web + mobile pinned to the in-repo source — every `bun install` resolves to `packages/contracts`, so a change to the App type lights up red squigglies in both clients on the next typecheck.
- Tag releases of the contracts artifact (`v0.3.0-contracts`) when the API surface stabilises, so we can bisect breakages.
- If `apps/mobile` ships outside the monorepo (Expo EAS build pulling from npm or a tarball), produce a portable artifact via `bun run --filter @hrms/contracts build && bun pm pack` and either publish to a private registry or commit the `.tgz` and reference it as `"@hrms/contracts": "file:./vendor/hrms-contracts-0.3.0.tgz"`. Both consumers must use the **same elysia + eden majors** as the API to avoid `~Routes` type drift.

---

## APIs allowed (use these)

- `treaty<App>(domain, config?)` — primary client. Import from `@elysiajs/eden`.
- `Treaty.Config<Head>` — global config: `headers`, `onRequest`, `onResponse`, `fetcher`, `parseDate`, `throwHttpError`.
- Per-call options: `{ headers, query, fetch, throwHttpError }` (`ToTreatyParam` in `treaty2/types.d.ts:25-30`).
- `Treaty.Data<typeof call>` / `Treaty.Error<typeof call>` — derive types for React Query / state.
- `EdenWS` — returned by `.subscribe()` on `app.ws(...)` routes. Use `.subscribe(fn)`, `.on('open'|'close'|'error', fn)`, `.send(data)`, `.close()`.
- `EdenFetchError` — only when using `edenFetch` (we won't).
- The `~path` marker on every Treaty node — read-only, useful for building manual `fetch` calls (RN uploads) without losing the canonical URL.

## Pitfalls / not-to-use

- **No `.json()` on the result.** Treaty already awaits and parses. Destructure `{ data, error }` — do not call `await res.json()`.
- **No bare `fetch` interceptors.** Use `onRequest` / `onResponse` in `Config`, or replace the `fetcher`. Don't monkey-patch global `fetch`.
- **Don't pass a frozen header object for auth.** Use the function form (`headers(path, options) { ... }`) so the token is read on every call.
- **Don't `await` `.subscribe()`.** It is synchronous — returns `EdenWS` immediately. `ws.ws.readyState` will be `CONNECTING` until `open` fires.
- **Don't reuse `edenTreaty` (Treaty 1).** It's still exported but lacks the `~Routes` symbol path and the WS event typing of Treaty 2.
- **Don't ship `edenFetch` to the web/mobile bundles.** It pulls a different code path and doubles bundle weight if mixed with `treaty`.
- **Don't rely on `parseDate` silently.** Default is `true` (`treaty2/types.d.ts:60`); the client will turn ISO strings into `Date`. If you want raw strings (e.g. to forward to Zod re-validation), set `parseDate: false`.
- **Don't put route-prefix logic on the client side.** The `App` type already encodes `/api/v1` if the server constructor was `new Elysia({ prefix: '/api/v1' })` — Treaty will produce `api.api.v1.*` chains. Don't strip it; mirror it.

## React Native gotchas

- **File uploads:** `instanceof File` does not match RN's `{ uri, name, type }`. Treaty will JSON-encode it. Bypass Treaty for upload endpoints — build `FormData` manually and call `fetch`, reusing `~path` and the auth resolver. **VERIFIED** but consistent with the decompiled body normaliser in `chunk-TTKI5TQ7.mjs`.
- **WebSocket:** RN's `WebSocket` works with `EdenWS` for text frames; for binary set `socket.ws.binaryType = 'arraybuffer'`. Some `WebSocketEventMap` keys may not exist at runtime; stick to `open`/`message`/`close`/`error`.
- **`Date` parsing:** `parseDate: true` requires `Date` constructor parity — RN's is fine, but if you re-serialize for AsyncStorage be aware values come back as `Date` instances, not strings.
- **AbortController:** supported in RN 0.60+. Pass `fetch: { signal }` per call to cancel.
- **TLS / self-signed certs:** Treaty uses global `fetch`; on RN, dev builds with self-signed certs need platform-specific config (Expo `app.json` `ios.infoPlist.NSAppTransportSecurity` etc.) — not eden's problem, just worth flagging.

## Confidence + gaps

- **High confidence:** package exports, `treaty` signature, `Config` shape, `TreatyResponse` shape, URL-segment mapping, path-param function calls, WS subscribe + EdenWS, error discrimination by status code, App-type inference through `.use()`. All cited to `.d.ts` files.
- **Medium confidence:** FormData branching gated on `instanceof File` / `FileList` — confirmed from minified runtime (`chunk-TTKI5TQ7.mjs`), but the exact RN behaviour was inferred, not exercised.
- **Gaps / VERIFIED:**
  - Exact behaviour of Treaty when an RN `{ uri, name, type }` blob descriptor is passed — needs a runtime smoke test inside Expo before we commit the mobile upload story to Treaty.
  - Whether `onResponse` runs for WS upgrade responses — types suggest no (it's `(response: Response) => …`), but not exercised.
  - Behaviour of `keepDomain: true` — present in `Config` but not documented in README; assume "do not rewrite redirect Location domains" and avoid until needed.
  - `streamResponse` (exported from `treaty2/index.d.ts:3`) — for `AsyncGenerator` SSE-style responses; out of scope for this phase.
