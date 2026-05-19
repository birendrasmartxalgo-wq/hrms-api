/**
 * jobs/autoPunchOut.ts
 * ---------------------
 * Auto punch-out cron job — runs daily at 13:00 UTC (6:30 PM IST).
 *
 * Logic ported verbatim from `src/jobs/autoPunchOut.js`.
 * Spec: api-contract/non-http-behaviors.md §Cron: Auto Punch Out
 *
 * Sentinel values preserved for legacy parity:
 *   punchOut.selfieUrl = "auto-punchout"
 *   source             = "auto"
 *
 * Status logic:
 *   netWorkingMinutes < 240 → "half_day"
 *   else                    → "present"
 *
 * This function is exported as `runAutoPunchOut` so it can be invoked
 * directly from test scripts / CLI without waiting for the cron trigger.
 */

import { ObjectId } from 'mongodb';
import { collections } from '../db/collections';
import type { AttendanceDocument, BreakEvent } from '../db/types/Attendance';

const HALF_DAY_MINUTES = 4 * 60; // 240 minutes

/** Returns today's date at UTC midnight. */
function todayMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Core job logic — callable from the cron trigger or from a test harness.
 * Returns the count of records that were successfully closed.
 */
export async function runAutoPunchOut(): Promise<number> {
  const today = todayMidnightUTC();

  // 6:30 PM IST = 13:00 UTC. If the job fires late (> 13:00 UTC), use now.
  const autoTime = new Date();
  autoTime.setUTCHours(13, 0, 0, 0);
  const punchOutTime = autoTime > new Date() ? new Date() : autoTime;

  // Find all records punched-in but not yet punched-out for today.
  const records = await collections
    .attendances()
    .find({
      date: today,
      'punchIn.time': { $exists: true },
      'punchOut.time': { $exists: false },
    })
    .toArray();

  if (records.length === 0) {
    console.log('[AutoPunchOut] No pending punch-outs for today.');
    return 0;
  }

  let count = 0;

  for (const rec of records) {
    try {
      // ── Close any open break ─────────────────────────────────────────────
      const breaks: BreakEvent[] = rec.breaks ?? [];
      let totalBreakMinutes = 0;

      for (const brk of breaks) {
        if (brk.startTime && !brk.endTime) {
          brk.endTime = punchOutTime;
          brk.durationMinutes = Math.max(
            0,
            Math.floor((punchOutTime.getTime() - new Date(brk.startTime).getTime()) / 60_000),
          );
        }
        if (brk.endTime) {
          totalBreakMinutes += brk.durationMinutes ?? 0;
        }
      }

      // ── Compute minutes ──────────────────────────────────────────────────
      const punchInTime = rec.punchIn?.time ? new Date(rec.punchIn.time) : punchOutTime;
      const totalWorkingMinutes = Math.max(
        0,
        Math.floor((punchOutTime.getTime() - punchInTime.getTime()) / 60_000),
      );
      const netWorkingMinutes = Math.max(totalWorkingMinutes - totalBreakMinutes, 0);
      const isHalfDay = netWorkingMinutes < HALF_DAY_MINUTES;

      // ── Build update ─────────────────────────────────────────────────────
      const update: Partial<AttendanceDocument> = {
        punchOut: {
          time: punchOutTime,
          location: rec.punchIn?.location ?? { lat: 0, lng: 0 },
          selfieUrl: 'auto-punchout',            // sentinel — legacy parity
          withinGeofence: rec.punchIn?.withinGeofence ?? false,
          distanceFromOffice: rec.punchIn?.distanceFromOffice ?? 0,
        },
        breaks,
        totalWorkingMinutes,
        totalBreakMinutes,
        netWorkingMinutes,
        isEarlyLeave: false,                     // 6:30 PM IS end of day
        status: isHalfDay ? 'half_day' : 'present',
        source: 'auto',                          // sentinel — legacy parity
        updatedAt: new Date(),
      };

      await collections.attendances().updateOne(
        { _id: rec._id },
        { $set: update },
      );

      count++;
      console.log(
        `[AutoPunchOut] ✅ employee=${rec.employee.toHexString()} — auto punched out at 6:30 PM (net=${netWorkingMinutes}m, status=${update.status})`,
      );
    } catch (innerErr: unknown) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      console.error(`[AutoPunchOut] ❌ Failed for employee ${rec.employee.toHexString()}:`, msg);
    }
  }

  console.log(`[AutoPunchOut] Done. Processed ${count}/${records.length} records.`);
  return count;
}
