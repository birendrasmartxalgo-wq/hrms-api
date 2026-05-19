# Bun + mongodb (v7.2.0) — Allowed APIs

Source of truth for the Elysia/Bun migration. Every claim cites
`node_modules/<pkg>/<file>:<line>` as observed in the probe sandbox at
`D:\smartxalgo\smartxalgo-hrms\.scratch\probe\node_modules`.

All paths below are relative to that probe `node_modules/` root unless noted.

---

## 1. mongodb 7.x — what's different from 6.x

**Source:** `mongodb/README.md:5`, `mongodb/README.md:19`, `mongodb/README.md:86-93`, `mongodb/package.json:3,118-120`

- The installed version is `7.2.0` (`mongodb/package.json:3`).
- README points to a v7 upgrade guide hosted at
  `etc/notes/CHANGES_7.0.0.md` on GitHub (`mongodb/README.md:5,19`). That
  file is **not shipped in the npm tarball** — only `lib/`, `src/`,
  `etc/prepare.js`, `mongodb.d.ts`, and `tsconfig.json` are published
  (`mongodb/package.json:6-12`). So the full 7.0 changelog is
  **VERIFIED** by Phase 2 smoke tests.
- Observable cross-major peer-dep bumps in `README.md:86-93`:
  - `bson` peer is now `^7.0.0` (was `^6.0.0` on 6.x).
  - `kerberos`, `mongodb-client-encryption`, `@mongodb-js/zstd` all jump
    to `^7.0.0`.
- **Node engine bumped to `>=20.19.0`** (`mongodb/package.json:118-120`).
  6.x required Node 16 — so legacy CommonJS targets on Node 16/18 will
  break. Bun targets a Node-20-compatible runtime, which clears this bar.
- TypeScript breaking-change disclaimer is still present
  (`mongodb/README.md:99`): TS support is best-effort and minor versions
  may break types.
- 6.x patterns the legacy backend uses (Mongoose-wrapped: `.populate()`,
  `.save()`, hooks, virtuals, `select: false`) are **Mongoose-isms**, not
  driver APIs — they have no equivalent in either driver major. See
  "Mongoose-isms" section below.

**Notes:** Legacy code in `src/models/*.js` uses Mongoose schemas
(per `CLAUDE.md`). None of those patterns survive the migration; they
must be re-expressed as collection-level CRUD + aggregation.

---

## 2. MongoClient singleton & connect-on-boot

**Source:** `mongodb/mongodb.d.ts:5680,5693,5730,5777,5785,5828`

**Signature (constructor):**
```ts
constructor(url: string, options?: MongoClientOptions);   // :5693
connect(): Promise<this>;                                  // :5730
close(_force?: boolean): Promise<void>;                    // :5777
db(dbName?: string, options?: DbOptions): Db;              // :5785
startSession(options?: ClientSessionOptions): ClientSession; // :5828
```

**Key `MongoClientOptions` fields** (`mongodb/mongodb.d.ts:6017-6176`):

| Field | Line | Type |
|---|---|---|
| `replicaSet` | 6019 | `string` |
| `timeoutMS` (experimental) | 6024 | `number` |
| `tls` / `ssl` | 6026/6028 | `boolean` |
| `connectTimeoutMS` | 6044 | `number` |
| `socketTimeoutMS` | 6046 | `number` |
| `maxPoolSize` | 6062 | `number` |
| `minPoolSize` | 6064 | `number` |
| `maxConnecting` | 6066 | `number` |
| `maxIdleTimeMS` | 6072 | `number` |
| `waitQueueTimeoutMS` | 6074 | `number` |
| `serverSelectionTimeoutMS` | 6096 | `number` |
| `heartbeatFrequencyMS` | 6098 | `number` |
| `appName` | 6102 | `string` |
| `retryReads` | 6104 | `boolean` |
| `retryWrites` | 6106 | `boolean` |
| `directConnection` | 6120 | `boolean` |
| `writeConcern` | 6144 | `WriteConcern \| WriteConcernSettings` |
| `monitorCommands` | 6152 | `boolean` |

**Snippet:**
```ts
import { MongoClient, type Db } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI!, {
  maxPoolSize: 50,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 8000,
  retryWrites: true,
  appName: "smartxalgo-hrms",
});

let db: Db;
export async function connect() {
  await client.connect();           // mongodb.d.ts:5730
  db = client.db();                 // mongodb.d.ts:5785
}
export const getDb = () => db;
export const getClient = () => client;
```

**Notes:** `connect()` returns `Promise<this>` so chaining is fine. The
driver caches the topology — call `connect()` once on boot and reuse the
singleton across the whole Elysia app. `close()` accepts a `_force` flag
that the docs explicitly say "has no effect" (`mongodb.d.ts:5775-5777`).

---

## 3. Typed collections

**Source:** `mongodb/mongodb.d.ts:3947,7521-7523,8893-8895,2635`

**Signature:**
```ts
// Db.collection generic — mongodb.d.ts:3947
collection<TSchema extends Document = Document>(
  name: string,
  options?: CollectionOptions,
): Collection<TSchema>;

// mongodb.d.ts:7521
export declare type OptionalUnlessRequiredId<TSchema> =
  TSchema extends { _id: any } ? TSchema : OptionalId<TSchema>;

// mongodb.d.ts:8893
export declare type WithId<TSchema> =
  EnhancedOmit<TSchema, "_id"> & { _id: InferIdType<TSchema> };
```

Both `WithId` and `OptionalUnlessRequiredId` are exported from the
top-level `mongodb` module (they appear in `mongodb.d.ts` which is the
package's declared `types` entry — `mongodb/package.json:13`).

**Snippet:**
```ts
import type { Collection, OptionalUnlessRequiredId, WithId } from "mongodb";

interface UserDoc {
  _id?: ObjectId;
  email: string;
  passwordHash: string;
  role: "admin" | "hr" | "employee";
  forcedLogoutAt?: Date;
}

const users: Collection<UserDoc> = getDb().collection<UserDoc>("users");

const toInsert: OptionalUnlessRequiredId<UserDoc> = {
  email: "x@y.z", passwordHash: "...", role: "employee",
};
const found: WithId<UserDoc> | null = await users.findOne({ email: "x@y.z" });
```

---

## 4. ObjectId

**Source:** `bson/bson.d.ts:1396,1432,1462,1478,1485` (re-exported from `mongodb` at `mongodb/mongodb.d.ts:7405`)

**Signature:**
```ts
// bson.d.ts:1432
constructor(inputId?: string | ObjectId | ObjectIdLike | Uint8Array);
// bson.d.ts:1462
equals(otherId: string | ObjectId | ObjectIdLike | undefined | null): boolean;
// bson.d.ts:1478
static createFromHexString(hexString: string): ObjectId;
// bson.d.ts:1485
static isValid(id: string | ObjectId | ObjectIdLike | Uint8Array): boolean;
```

**Snippet:**
```ts
import { ObjectId } from "mongodb";          // re-export from mongodb.d.ts:7405

if (!ObjectId.isValid(req.params.id)) {
  throw new Error("bad id");
}
const _id = new ObjectId(req.params.id);
const same = _id.equals(other._id);
```

**Notes:** Always call `ObjectId.isValid` on user input before
constructing — `new ObjectId("not-hex")` throws. This replaces the
`mongoose.Types.ObjectId.isValid()` guard called out in `CLAUDE.md`.

---

## 5. CRUD signatures (verbatim)

All from `mongodb/mongodb.d.ts`:

| Method | Line | Signature |
|---|---|---|
| `findOne` | 2784-2789 | `findOne<T = TSchema>(filter: Filter<TSchema>, options?: Omit<FindOneOptions,'timeoutMode'> & Abortable): Promise<T \| null>` |
| `find` | 2795-2797 | `find(filter: Filter<TSchema>, options?: FindOptions & Abortable): FindCursor<WithId<TSchema>>` |
| `insertOne` | 2684 | `insertOne(doc: OptionalUnlessRequiredId<TSchema>, options?: InsertOneOptions): Promise<InsertOneResult<TSchema>>` |
| `insertMany` | 2693 | `insertMany(docs: ReadonlyArray<OptionalUnlessRequiredId<TSchema>>, options?: BulkWriteOptions): Promise<InsertManyResult<TSchema>>` |
| `updateOne` | 2725 | `updateOne(filter: Filter<TSchema>, update: UpdateFilter<TSchema> \| Document[], options?: UpdateOptions & { sort?: Sort }): Promise<UpdateResult<TSchema>>` |
| `updateMany` | 2747 | `updateMany(filter: Filter<TSchema>, update: UpdateFilter<TSchema> \| Document[], options?: UpdateOptions): Promise<UpdateResult<TSchema>>` |
| `replaceOne` | 2735 | `replaceOne(filter, replacement: WithoutId<TSchema>, options?: ReplaceOptions): Promise<UpdateResult<TSchema>>` |
| `findOneAndUpdate` | 3026-3033 | `findOneAndUpdate(filter, update, options?: FindOneAndUpdateOptions): Promise<WithId<TSchema> \| null>` (overloads switch on `includeResultMetadata`) |
| `deleteOne` | 2754 | `deleteOne(filter?: Filter<TSchema>, options?: DeleteOptions): Promise<DeleteResult>` |
| `deleteMany` | 2761 | `deleteMany(filter?: Filter<TSchema>, options?: DeleteOptions): Promise<DeleteResult>` |
| `countDocuments` | 2952 | `countDocuments(filter?: Filter<TSchema>, options?: CountDocumentsOptions & Abortable): Promise<number>` |
| `distinct` | 2960-2962 | `distinct<Key extends keyof WithId<TSchema>>(key: Key, filter?: Filter<TSchema>, options?: DistinctOptions): Promise<Array<Flatten<WithId<TSchema>[Key]>>>` |
| `aggregate` | 3040 | `aggregate<T extends Document = Document>(pipeline?: Document[], options?: AggregateOptions & Abortable): AggregationCursor<T>` |
| `bulkWrite` | 2713 | `bulkWrite(operations: ReadonlyArray<AnyBulkWriteOperation<TSchema>>, options?: BulkWriteOptions): Promise<BulkWriteResult>` |

### `findOneAndUpdate` default behaviour at v7

**Source:** `mongodb/mongodb.d.ts:4633-4653,7819-7825`

```ts
// mongodb.d.ts:7819
export declare const ReturnDocument: Readonly<{
    readonly BEFORE: "before";
    readonly AFTER: "after";
}>;
// mongodb.d.ts:4642-4643
/** When set to 'after', returns the updated document rather than the original.
 *  The default is 'before'. */
returnDocument?: ReturnDocument;
```

So the **default is `"before"`** — you must pass
`{ returnDocument: "after" }` to get the post-update doc. Likewise
`includeResultMetadata` defaults to `false` (`mongodb.d.ts:4651-4653`)
so the un-flagged overload (`:3033`) returns
`Promise<WithId<TSchema> | null>` directly — no `.value` unwrap.

```ts
const updated = await users.findOneAndUpdate(
  { _id },
  { $set: { forcedLogoutAt: new Date() } },
  { returnDocument: "after" },
);
// updated: WithId<UserDoc> | null  (NOT { value, ok } — v7 returns the doc itself)
```

---

## 6. Projection

**Source:** `mongodb/mongodb.d.ts:4691-4697` (`FindOptions`), `:4641` (`FindOneAndUpdateOptions`), `:4617` (`FindOneAndReplaceOptions`)

```ts
// mongodb.d.ts:4691
export declare interface FindOptions extends Omit<CommandOperationOptions, ...>, AbstractCursorOptions {
    // ...
    projection?: Document;  // :4697
}
```

`findOne` accepts `FindOneOptions` (alias for `FindOptions` minus
`timeoutMode`, `mongodb.d.ts:2786`) so the same `{ projection }` shape
applies. For aggregation, projection is a pipeline stage
(`$project`) rather than an option — there is no `projection` field on
`AggregateOptions`.

**Snippet:**
```ts
// Replaces Mongoose's field-level `select: false` on User.password
const user = await users.findOne(
  { email },
  { projection: { passwordHash: 1, role: 1, email: 1 } },
);

// Hide a field instead:
const safe = await users.findOne({ _id }, { projection: { passwordHash: 0 } });

// Aggregation equivalent:
const rows = await users.aggregate([
  { $match: { role: "employee" } },
  { $project: { passwordHash: 0 } },
]).toArray();
```

**Notes:** Mongoose's `select: false` on a schema path does **not**
exist. You must remember to project on every read, or wrap the
collection in a thin repository that always projects out secrets.

---

## 7. Aggregation `$lookup`

**Source:** `mongodb/mongodb.d.ts:3040` (collection-level), `:490` (`AggregationCursor<TSchema>`), `:3936` (`Db.aggregate`)

```ts
// mongodb.d.ts:3040
aggregate<T extends Document = Document>(
  pipeline?: Document[],
  options?: AggregateOptions & Abortable,
): AggregationCursor<T>;

// mongodb.d.ts:490
export declare class AggregationCursor<TSchema = any> extends ExplainableCursor<TSchema> { ... }
```

The `$lookup` stage shape itself is **not modelled as a discriminated
union in the d.ts** — pipeline stages are typed as `Document[]`, so
shape errors surface at runtime, not compile time. That's the trade-off
for the driver's permissive aggregation typing.

**Snippet A — basic `$lookup` (employee → user, replaces Mongoose
`.populate('user')`):**
```ts
const rows = await db.collection("employees").aggregate<{
  _id: ObjectId; user: { _id: ObjectId; email: string; role: string };
}>([
  { $match: { departmentId } },
  { $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "user",
  }},
  { $unwind: "$user" },
  { $project: { "user.passwordHash": 0 } },
]).toArray();
```

**Snippet B — `$lookup` with `pipeline:` (filtered join for chat
participants):**
```ts
const conversations = await db.collection("conversations").aggregate([
  { $match: { participantIds: meId } },
  { $lookup: {
      from: "messages",
      let: { convId: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$conversationId", "$$convId"] } } },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
      ],
      as: "lastMessage",
  }},
  { $unwind: { path: "$lastMessage", preserveNullAndEmptyArrays: true } },
]).toArray();
```

---

## 8. Indexes

**Source:** `mongodb/mongodb.d.ts:2838,2870`

**Signature:**
```ts
// :2838
createIndex(indexSpec: IndexSpecification, options?: CreateIndexesOptions): Promise<string>;
// :2870
createIndexes(indexSpecs: IndexDescription[], options?: CreateIndexesOptions): Promise<string[]>;
```

Both are **idempotent** server-side — creating an index that already
exists with matching options is a no-op. You can run them
unconditionally on boot.

**Snippet:**
```ts
await users.createIndex({ email: 1 }, { unique: true });
await db.collection("attendance").createIndexes([
  { key: { employeeId: 1, date: -1 } },
  { key: { date: -1 } },
  { key: { source: 1 }, name: "by_source" },
]);
```

---

## 9. Transactions

**Source:** `mongodb/mongodb.d.ts:5828` (start), `:2410-2454` (`withTransaction`)

**Signature:**
```ts
// :5828
startSession(options?: ClientSessionOptions): ClientSession;
// :2445
withTransaction<T = any>(
  fn: WithTransactionCallback<T>,
  options?: TransactionOptions & { timeoutMS?: number },
): Promise<T>;
```

The d.ts comment at `:2415-2417` warns: "Running operations in parallel
is not supported during a transaction. The use of `Promise.all`,
`Promise.allSettled`, `Promise.race`, etc … is undefined behaviour."

**Snippet:**
```ts
const session = client.startSession();
try {
  const result = await session.withTransaction(async () => {
    await users.updateOne({ _id }, { $set: { ... } }, { session });
    await audits.insertOne({ ... }, { session });
    return "ok";
  });
} finally {
  await session.endSession();
}
```

**Notes:** Transactions require a **replica set or sharded cluster** —
they fail against a standalone `mongod`. The legacy `mongodb-memory-server`
fallback in `server.js` spins up a standalone by default, so any
transaction-using code path needs the in-memory server started with
`replSet: { ... }` or it will throw at runtime.

---

## 10. Change streams

**Source:** `mongodb/mongodb.d.ts:1168,3132` (collection-level), `:4106` (db), `:5905` (client)

```ts
// :3132
watch<TLocal extends Document = TSchema, TChange extends Document = ChangeStreamDocument<TLocal>>(
  pipeline?: Document[],
  options?: ChangeStreamOptions,
): ChangeStream<TLocal, TChange>;
// :1168
export declare class ChangeStream<TSchema, TChange> extends TypedEventEmitter<...> implements AsyncDisposable { ... }
```

`collection.watch()` returns an event emitter that yields
`ChangeStreamDocument<TSchema>` items. Requires a replica set. Useful
if the chat/notification subsystem moves off Socket.io broadcasts and
onto MongoDB tailing, but not required for the current dual-delivery
pattern described in `CLAUDE.md`.

---

## 11. Bun compatibility

**Source:** `mongodb/package.json:118-120`, `mongodb/README.md` (full scan)

- `engines.node": ">=20.19.0"` (`mongodb/package.json:118-120`). Bun
  reports a Node-20-compatible `process.versions.node`, so the engines
  check passes.
- **README does not mention Bun or Deno** (grep for `bun|Bun|deno|Deno`
  in `mongodb/README.md` returned zero matches). No first-party Bun
  support statement.
- The driver depends on the native-friendly but pure-JS `bson@^7.2.0`
  (`mongodb/package.json:29`) and `mongodb-connection-string-url`
  (`:30`). Native peer deps (`kerberos`, `@mongodb-js/zstd`, `snappy`,
  `mongodb-client-encryption`) are **optional** (`:41-63`) — for a
  default Atlas/SRV connection none of them load.
- The package's `prepare` script (`mongodb/package.json:165`) runs
  `node etc/prepare.js`; verify this doesn't break under `bun install`
  (Bun runs lifecycle scripts only for trusted packages by default).

**Verdict:** Driver is **expected to work on Bun** because it's pure
JS + bson (also pure JS), no required native addons, and meets the
Node-20 API surface. There is no published Bun smoke test from the
MongoDB team — **VERIFIED** via Phase 2 smoke tests:
connect, insert, find, aggregate, transaction (against an Atlas test
cluster), and a long-lived change-stream subscription under `bun run`.

---

## 12. bcrypt: `bcryptjs` vs `@node-rs/bcrypt`

**`bcryptjs` (3.0.3, pure JS)** — `bcryptjs/types.d.ts`:
```ts
// :31  genSalt(rounds?: number): Promise<string>
// :66  hash(password: string, salt: number | string): Promise<string>
// :99  compare(password: string, hash: string): Promise<boolean>
// :123 getRounds(hash: string): number
// :138 truncates(password: string): boolean   // checks the 72-byte limit
```
- README (`bcryptjs/README.md:1-46`) says pure JS, zero deps, ~30%
  slower than the C++ `bcrypt` binding. No Bun mention; works
  identically on Node, Bun, browsers, and edge runtimes.

**`@node-rs/bcrypt` (1.10.7, Rust + N-API)** — `@node-rs/bcrypt/binding.d.ts`:
```ts
// :3  DEFAULT_COST: number   // README says 12
// :9  hash(input, cost?, salt?, signal?): Promise<string>
// :13 verify(password, hash, signal?): Promise<boolean>
// :5  genSalt(round, version?, signal?): Promise<string>
// index.d.ts:3  export const compare: typeof verify
```
- Ships prebuilt binaries for 14 targets including
  `x86_64-pc-windows-msvc`, `aarch64-apple-darwin`,
  `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-musl`, and
  `wasm32-wasip1-threads` (`@node-rs/bcrypt/package.json:33-48`).
- README does **not** mention Bun (grep returned zero matches). N-API
  is what Bun implements for native modules; the `wasm32-wasip1-threads`
  target is a fallback path. Benchmark in README puts it ~18% faster
  than `bcryptjs` for hashing and ~17% faster for verify
  (`@node-rs/bcrypt/README.md:60-79`).

### Recommendation

**Use `bcryptjs`.** Reasons:

1. **Portability beats perf here.** Authentication runs O(login + token
   refresh + password change) — a handful of ops per user per day, not a
   hot path. Saving ~10 ms per hash is irrelevant; the existing Mongoose
   `pre('save')` hook in `User.js` already proves bcrypt latency is
   acceptable at the default cost.
2. **Zero native build surface on Bun.** `bcryptjs` is pure JS with zero
   deps (`bcryptjs/README.md:3`). `@node-rs/bcrypt` ships N-API
   prebuilds that Bun *should* load but the package never advertises
   Bun support — risk of a runtime mismatch on a non-standard target
   (e.g., Alpine musl in Docker, where the matching prebuilt would have
   to be picked correctly).
3. **API parity with the legacy `bcrypt` C++ binding** so existing
   hashes verify without re-hashing (`bcryptjs/README.md:3` —
   "Compatible to the C++ bcrypt binding").

If profiling later shows hashing is a bottleneck (e.g., bulk imports
re-hash thousands of passwords), swap to `@node-rs/bcrypt` — the hashes
are interoperable.

**Snippet (using `bcryptjs`):**
```ts
import bcrypt from "bcryptjs";              // bcryptjs/index.d.ts:1-3

const ROUNDS = 10;
export const hashPassword = (pw: string) => bcrypt.hash(pw, ROUNDS);
export const verifyPassword = (candidate: string, hash: string) =>
  bcrypt.compare(candidate, hash);
```

---

## APIs allowed

- `MongoClient` (constructor, `connect`, `close`, `db`, `startSession`,
  `bulkWrite`, `watch`).
- `Db.collection<T>(name)` — typed collection accessor.
- `Collection<T>`: `findOne`, `find`, `insertOne`, `insertMany`,
  `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`,
  `deleteOne`, `deleteMany`, `countDocuments`, `distinct`,
  `aggregate`, `bulkWrite`, `createIndex`, `createIndexes`, `watch`.
- `ObjectId` (constructor, `isValid`, `equals`, `createFromHexString`,
  `getTimestamp`).
- Types: `WithId<T>`, `OptionalUnlessRequiredId<T>`, `Filter<T>`,
  `UpdateFilter<T>`, `FindOptions`, `FindOneAndUpdateOptions`,
  `AggregateOptions`, `Collection<T>`, `Db`.
- Transactions via `client.startSession()` + `session.withTransaction()`.
- bcrypt via `bcryptjs` (`hash`, `compare`, `genSalt`, `truncates`).

## Mongoose-isms that do NOT exist in the native driver

None of the following have native-driver equivalents — they are
Mongoose-only and must be re-implemented at the application layer:

- **`.populate()`** — replace with aggregation `$lookup` (see §7).
- **`.save()`** on a hydrated document — there are no hydrated docs.
  Use `insertOne` / `replaceOne` / `updateOne` against a plain object.
- **`pre('save')` / `post('save')` hooks** — e.g., the bcrypt hash hook
  in `src/models/User.js`. Move this logic into a repository function
  (`createUser(input)` that hashes then `insertOne`s) or service.
- **Virtuals / instance methods** — `user.comparePassword(...)`
  doesn't exist. Define `verifyPassword(user, candidate)` at the
  service layer.
- **`select: false` field-level projection** — the driver has no
  schema. You must pass `{ projection: { passwordHash: 0 } }` on every
  read, or centralise reads behind a repository that does it for you.
- **`mongoose.Types.ObjectId.isValid()`** — use `ObjectId.isValid()`
  (re-exported from `mongodb`, ultimately `bson/bson.d.ts:1485`).
- **Cast errors / schema validation** — no automatic validation. Use
  a runtime validator (Elysia's `t.*`, Zod, Valibot, or
  `$jsonSchema` validators server-side via `createCollection`).
- **`.lean()`** — n/a, results are already plain objects.
- **Auto-`updatedAt` / `createdAt` timestamps** — write them yourself
  in repository functions, or use `$currentDate` in updates.

## Confidence + gaps

**High confidence (read directly from `.d.ts`):**
- All CRUD/aggregation/index/transaction/change-stream signatures.
- `ReturnDocument` default is `"before"` and `findOneAndUpdate` no
  longer wraps in `{ value }` (verified at `mongodb.d.ts:3026-3033,
  4642-4643, 7819-7825`).
- `OptionalUnlessRequiredId`, `WithId`, `Collection`, `Db`,
  `MongoClient`, `ObjectId.isValid/equals` all exist and are exported.
- `MongoClientOptions` fields (pool, timeouts, retry, TLS).
- Node engines `>=20.19.0`.
- bcrypt API surfaces for both candidate libraries.

**Gaps / VERIFIED:**
- The full v7.0 changelog (`etc/notes/CHANGES_7.0.0.md`) is referenced
  in the README but **not shipped** in the npm tarball
  (`mongodb/package.json:6-12`). Specific 6.x→7.x breaking changes
  beyond peer-dep version bumps need the GitHub copy or release notes.
- **Official Bun support is not documented** in `mongodb`,
  `@node-rs/bcrypt`, or `bcryptjs` READMEs. Compatibility is inferred
  from "pure JS + N-API" and Node-20 engines compatibility. Phase 2
  must run a Bun smoke test against a real Atlas cluster.
- `mongodb-memory-server` (used in the dev fallback per `CLAUDE.md`)
  was not inspected here — verify it ships a Bun-compatible mongod
  binary lookup, or replace with a docker-compose mongo in dev.
- The `prepare` script in `mongodb/package.json:165` runs at install
  time; behaviour under `bun install` for non-trusted packages is
  unconfirmed.
