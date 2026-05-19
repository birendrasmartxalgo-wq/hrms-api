import { collections } from '../../db/collections';
import { ObjectId } from 'mongodb';
import { checkGeofenceAsync } from '../../services/geofence';
import { env } from '../../env';
import type { AuthUser } from '../../plugins/auth';

const OFFICE_START_HOUR = 8.5;  // 8:30 AM IST
const OFFICE_END_HOUR   = 17.5; // 5:30 PM IST
const HALF_DAY_HOURS    = 4;    // < 4h net = half day
const LATE_CUTOFF_MINS  = 8 * 60 + 45;  // 8:45 AM
const EARLY_LEAVE_MINS  = 16 * 60 + 30;  // 4:30 PM

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const AttendanceService = {
  async checkAttendanceAccess(user: AuthUser) {
    if (!user.employeeId) return { blocked: true, message: 'Employee record not found' };
    
    const emp = await collections.employees().findOne({ _id: new ObjectId(user.employeeId) });
    if (!emp) return { blocked: true, message: 'Employee record not found' };

    if (emp.onboardingStatus !== 'approved') {
      return { blocked: true, message: 'Your account is not yet approved for attendance. Please contact HR.' };
    }

    const setting = await collections.settings().findOne({ key: 'attendance_allowed_roles' });
    const allowedRoles = setting?.value || ['employee', 'hr'];
    if (!allowedRoles.includes(user.role)) {
      return { blocked: true, message: `Attendance marking is not enabled for your role (${user.role}).` };
    }

    if (emp.canMarkAttendance === false) {
      return { blocked: true, message: 'Your attendance access has been disabled. Please contact your administrator.' };
    }

    return { blocked: false, emp };
  },

  async isHolidayOrWeekend(date: Date) {
    const day = date.getDay();
    if (day === 0) return { skip: true, reason: 'Weekend' };
    const holiday = await collections.holidays().findOne({ date: { $lte: date, $gte: date } });
    if (holiday) return { skip: true, reason: `Holiday: ${holiday.name}` };
    return { skip: false };
  },

  calcWorkingMinutes(punchIn: Date, punchOut: Date) {
    return Math.floor((new Date(punchOut).getTime() - new Date(punchIn).getTime()) / 60000);
  },

  calcBreakMinutes(breaks: any[]) {
    return (breaks || [])
      .filter((b: any) => b.endTime)
      .reduce((sum: number, b: any) => sum + (b.durationMinutes || 0), 0);
  },

  activityMap: new Map<string, any>(),

  // other functions will be called from controller
};
