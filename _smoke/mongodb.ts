import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function main() {
  console.log('Starting MongoMemoryReplSet...');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db('smoke_test');
    const coll = db.collection('test_crud');

    // 1. Insert
    const insertRes = await coll.insertOne({ name: 'bun-test', value: 42 });
    console.log('Inserted:', insertRes.insertedId);

    // 2. Read
    const doc = await coll.findOne({ _id: insertRes.insertedId });
    console.log('Read:', doc?.name);

    // 3. Update with findOneAndUpdate returning WithId<T> | null
    const updated = await coll.findOneAndUpdate(
      { _id: insertRes.insertedId },
      { $set: { value: 100 } },
      { returnDocument: 'after' }
    );
    console.log('Updated shape:', Object.keys(updated || {}));
    console.log('Updated value:', updated?.value); // should be 100

    // 4. Transaction
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await coll.insertOne({ name: 'tx-test' }, { session });
        throw new Error('Rollback expected');
      });
    } catch (e: any) {
      console.log('Transaction result:', e.message);
    } finally {
      await session.endSession();
    }

    const txDoc = await coll.findOne({ name: 'tx-test' });
    console.log('Doc after rollback (should be null):', txDoc);

    // 5. Delete
    await coll.deleteMany({});
    console.log('Cleaned up');
  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exit(1);
  } finally {
    await client.close();
    await replSet.stop();
  }
}

main();
