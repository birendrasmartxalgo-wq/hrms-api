/**
 * Seed default holidays for a given year.
 *
 * Idempotent: inserts only entries that don't already match by (year, name).
 * Run from the apps/api workspace:
 *   bun run src/scripts/seed-holidays.ts          # current FY
 *   bun run src/scripts/seed-holidays.ts 2027     # explicit year
 *
 * Edit DEFAULTS below to extend the list. Locations are advisory — the org
 * may override per region via /admin endpoints later.
 */
import { ObjectId } from 'mongodb';
import { connectDb, getDb } from '../db/client';
import { collections } from '../db/collections';
import type { HolidayType } from '../db/types/Leave';

type Seed = {
  name: string;
  month: number; // 1-12
  day: number;
  type: HolidayType;
};

// Default seeds for India. Extend as needed — re-running is safe.
const DEFAULTS: Record<number, Seed[]> = {
  2026: [
    { name: 'Holi', month: 3, day: 25, type: 'national' },
    { name: 'Ambedkar Jayanti', month: 4, day: 14, type: 'optional' },
    { name: 'Buddha Purnima', month: 5, day: 23, type: 'regional' },
    { name: 'Independence Day', month: 8, day: 15, type: 'national' },
    { name: 'Gandhi Jayanti', month: 10, day: 2, type: 'national' },
    { name: 'Diwali', month: 10, day: 21, type: 'regional' },
    { name: 'Christmas', month: 12, day: 25, type: 'national' },
  ],
};

async function main() {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  const seeds = DEFAULTS[year];
  if (!seeds) {
    console.error(`[seed-holidays] no defaults for year ${year} — extend DEFAULTS in this script.`);
    process.exit(1);
  }

  await connectDb();
  console.log(`[seed-holidays] connected to ${getDb().databaseName}`);

  let inserted = 0;
  let skipped = 0;

  for (const s of seeds) {
    const existing = await collections.holidays().findOne({ year, name: s.name });
    if (existing) {
      skipped++;
      continue;
    }
    await collections.holidays().insertOne({
      _id: new ObjectId(),
      name: s.name,
      date: new Date(year, s.month - 1, s.day),
      type: s.type,
      year,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    inserted++;
  }

  console.log(
    `[seed-holidays] year=${year} → inserted=${inserted}, skipped=${skipped} (already present).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-holidays] failed:', err);
  process.exit(1);
});
