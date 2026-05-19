# Phase 3: DB Types & Indexes (Mongoose replacement)

With Mongoose removed, the target architecture for `apps/api` uses the native `mongodb` driver. To maintain type safety and validation, we follow a strict pattern for every ported legacy model.

## 1. Document Interface (`src/db/types/<ModelName>.ts`)

Each collection must have a TypeScript interface that perfectly matches the legacy Mongoose schema fields, exporting a `<ModelName>Document` interface.

```typescript
import type { ObjectId } from 'mongodb';

// If there are enums, export them as union types:
export type UserRole = 'admin' | 'hr' | 'employee';

export interface UserDocument {
  _id: ObjectId;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  employee?: ObjectId;  // Use ObjectId for reference fields
  isActive?: boolean;
  forcedLogoutAt?: Date | null;
  lockedUntil?: Date | null;
  createdAt?: Date;     // Replaces Mongoose auto-timestamps
  updatedAt?: Date;
}
```

## 2. Zod Schemas for Validation

Since Mongoose validation is gone, all `insert` and `update` logic should be validated by a Zod schema. If the model is exposed via the API (like DTOs), the Zod schema is typically defined in `packages/contracts/src/schemas/` and imported here or in the specific module.

```typescript
import { z } from 'zod';

export const UserInsertSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(['admin', 'hr', 'employee']),
  // ...
});
```

## 3. Collection Accessor (`src/db/collections.ts`)

Expose a typed collection getter for the new model.

```typescript
import type { Collection } from 'mongodb';
import { getDb } from './client';
import type { UserDocument } from './types/User';

export const collections = {
  users(): Collection<UserDocument> {
    return getDb().collection<UserDocument>('users');
  },
  // Add new collections here...
};
```

## 4. Index Creation (`src/db/indexes.ts`)

Mongoose automatically created indexes via schema definitions (`unique: true`, `index: true`). In the native driver, we do this explicitly on application boot via `db.collection('...').createIndexes([...])`.

```typescript
import type { Db } from 'mongodb';

export async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('users').createIndexes([
      { key: { email: 1 }, unique: true, name: 'users_email_unique' },
      { key: { employee: 1 }, sparse: true, name: 'users_employee_idx' },
      { key: { role: 1, isActive: 1 }, name: 'users_role_active_idx' },
    ]),
    // Port additional model indexes here...
  ]);
}
```

## 5. Hook Equivalents (e.g., `pre('save')`)

- **Password Hashing:** There is no `pre('save')`. Hashing must happen explicitly in the service layer (`src/modules/*/service.ts`) before calling `insertOne` or `updateOne`.
- **Timestamps:** Set `createdAt: new Date()` manually on insert, and `$set: { updatedAt: new Date() }` on update.
- **Population:** Replace `populate()` with explicit MongoDB aggregation pipelines using `$lookup` in the service methods.
