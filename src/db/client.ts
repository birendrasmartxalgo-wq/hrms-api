import { MongoClient, type Db } from 'mongodb';
import { env } from '../env';
import { ensureIndexes } from './indexes';

let client: MongoClient | undefined;
let db: Db | undefined;
let connectPromise: Promise<Db> | undefined;

function databaseNameFromUri(uri: string) {
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\//, '');
  return dbName || 'hrms';
}

export async function connectDb() {
  if (db) return db;

  const uri = env.MONGO_URI;
  if (!uri) {
    throw new Error('[db] MONGO_URI is required once the DB plugin is enabled');
  }

  connectPromise ??= (async () => {
    client = new MongoClient(uri);
    await client.connect();

    const connectedDb = client.db(databaseNameFromUri(uri));
    await ensureIndexes(connectedDb);
    db = connectedDb;

    return connectedDb;
  })();

  return connectPromise;
}

export function getDb() {
  if (!db) {
    throw new Error('[db] Database has not been connected yet');
  }

  return db;
}

export async function closeDb() {
  await client?.close();
  client = undefined;
  db = undefined;
  connectPromise = undefined;
}
