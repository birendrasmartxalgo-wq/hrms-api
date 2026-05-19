import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import { utcMidnight, datePartIST, startOfMonthIST, endOfMonthIST } from '../../utils/time';
import { checkGeofenceAsync } from '../../services/geofence';
import { isValidObjectId, toObjectId } from '../../utils/ids';

export const AdminService = {
  async getDashboardStats() {
    const now = new Date();
    const today = utcMidnight();

    const [totalEmployees, presentToday, onLeaveToday, attendanceRecords] = await Promise.all([
      collections.employees().countDocuments({ isActive: { $ne: false } }),
      collections.attendances().countDocuments({ date: today, status: { $ne: 'absent' } }),
      collections.leaveRequests().countDocuments({
        status: 'approved',
        startDate: { $lte: today },
        endDate: { $gte: today },
      }),
      collections.attendances().find({ date: today }).toArray(),
    ]);

    // Present today breakdown
    const loggedIn = attendanceRecords.filter((a) => a.punchIn && !a.punchOut);
    const loggedOut = attendanceRecords.filter((a) => a.punchOut);
    const onBreak = attendanceRecords.filter((a) => {
      if (!a.punchIn || a.punchOut) return false;
      return (a.breaks || []).some((b) => b.startTime && !b.endTime);
    });
    const absent = totalEmployees - presentToday;

    // Late arrivals
    const lateArrivals = attendanceRecords.filter((a) => a.isLate).length;

    // On leave details
    const leaveDetails = await collections.leaveRequests()
      .aggregate([
        {
          $match: {
            status: 'approved',
            startDate: { $lte: today },
            endDate: { $gte: today },
          },
        },
        {
          $lookup: {
            from: 'employees',
            localField: 'employee',
            foreignField: '_id',
            as: 'employee',
          },
        },
        { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
        { $limit: 50 },
      ])
      .toArray();

    // Upcoming leaves (next 7 days)
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingLeaves = await collections.leaveRequests()
      .aggregate([
        {
          $match: {
            status: 'approved',
            startDate: { $gte: today, $lte: nextWeek },
          },
        },
        {
          $lookup: {
            from: 'employees',
            localField: 'employee',
            foreignField: '_id',
            as: 'employee',
          },
        },
        { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
        { $sort: { startDate: 1 } },
        { $limit: 20 },
      ])
      .toArray();

    // Average working hours
    const totalWorkingMinutes = attendanceRecords.reduce(
      (sum, a) => sum + (a.netWorkingMinutes || 0), 0,
    );
    const avgWorkingHours = presentToday > 0
      ? (totalWorkingMinutes / presentToday / 60).toFixed(1)
      : '0.0';

    return {
      totalEmployees,
      presentToday: {
        total: presentToday,
        loggedIn: loggedIn.length,
        loggedOut: loggedOut.length,
        onBreak: onBreak.length,
        list: attendanceRecords.slice(0, 20).map((a) => ({
          employee: a.employee,
          status: a.punchOut ? 'logged_out' : a.breaks?.some((b) => !b.endTime) ? 'on_break' : 'logged_in',
        })),
      },
      onLeave: {
        count: onLeaveToday,
        details: leaveDetails,
      },
      upcomingLeaves,
      absent,
      lateArrivals,
      averageWorkingHours: avgWorkingHours,
    };
  },

  async getRecentActivity() {
    const today = utcMidnight();
    const records = await collections.attendances()
      .aggregate([
        { $match: { date: today } },
        {
          $lookup: {
            from: 'employees',
            localField: 'employee',
            foreignField: '_id',
            as: 'employee',
          },
        },
        { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
        { $sort: { updatedAt: -1 } },
        { $limit: 50 },
      ])
      .toArray();

    const activities: any[] = [];
    for (const record of records) {
      const empName = record.employee?.name || 'Unknown';
      if (record.punchIn?.time) {
        activities.push({
          type: 'punch_in',
          employee: empName,
          employeeId: record.employee?._id,
          time: record.punchIn.time,
          recordId: record._id,
        });
      }
      if (record.punchOut?.time) {
        activities.push({
          type: 'punch_out',
          employee: empName,
          employeeId: record.employee?._id,
          time: record.punchOut.time,
          recordId: record._id,
        });
      }
      for (const br of record.breaks || []) {
        if (br.startTime) {
          activities.push({
            type: 'break_start',
            employee: empName,
            employeeId: record.employee?._id,
            time: br.startTime,
            breakType: br.type,
            recordId: record._id,
          });
        }
        if (br.endTime) {
          activities.push({
            type: 'break_end',
            employee: empName,
            employeeId: record.employee?._id,
            time: br.endTime,
            breakType: br.type,
            recordId: record._id,
          });
        }
      }
    }

    activities.sort((a, b) => b.time.getTime() - a.time.getTime());
    return activities.slice(0, 20);
  },

  async getDepartmentBreakdown() {
    const today = utcMidnight();

    const [employees, attendance, leaveRequests] = await Promise.all([
      collections.employees().find({ isActive: { $ne: false } }).toArray(),
      collections.attendances().find({ date: today }).toArray(),
      collections.leaveRequests()
        .find({ status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } })
        .toArray(),
    ]);

    const deptMap = new Map<string, any>();

    for (const emp of employees) {
      const deptId = emp.department?.toString() || 'unassigned';
      if (!deptMap.has(deptId)) {
        deptMap.set(deptId, {
          department: emp.department || 'Unassigned',
          total: 0, present: 0, absent: 0, onLeave: 0, late: 0,
        });
      }
      deptMap.get(deptId).total++;
    }

    const presentSet = new Set(attendance.map((a) => a.employee.toString()));
    const leaveSet = new Set(leaveRequests.map((l) => l.employee.toString()));

    for (const emp of employees) {
      const deptId = emp.department?.toString() || 'unassigned';
      const dept = deptMap.get(deptId);
      if (!dept) continue;

      if (presentSet.has(emp._id.toString())) {
        dept.present++;
        const att = attendance.find((a) => a.employee.toString() === emp._id.toString());
        if (att?.isLate) dept.late++;
      }
      if (leaveSet.has(emp._id.toString())) dept.onLeave++;
      if (!presentSet.has(emp._id.toString()) && !leaveSet.has(emp._id.toString())) {
        dept.absent++;
      }
    }

    return Array.from(deptMap.values());
  },

  async getDocDeadlineWarnings() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const employees = await collections.employees()
      .aggregate([
        { $match: { onboardingStatus: 'pending_documents' } },
        {
          $lookup: {
            from: 'departments',
            localField: 'department',
            foreignField: '_id',
            as: 'department',
          },
        },
        { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'documents',
            localField: '_id',
            foreignField: 'employee',
            as: 'documents',
          },
        },
      ])
      .toArray();

    const warnings = employees.map((emp) => {
      const uploadedTypes = (emp.documents || []).map((d: any) => d.type);
      const mandatoryTypes = ['aadhar', 'pan', 'bank_details', 'qualification_cert', 'nda', 'offer_letter', 'joining_letter'];
      const missing = mandatoryTypes.filter((t) => !uploadedTypes.includes(t));
      const createdAt = emp.createdAt || new Date();
      const daysElapsed = Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
      const isBlocked = daysElapsed > 7;
      const isUrgent = daysElapsed > 5;

      return {
        employee: emp,
        missingDocuments: missing,
        missingCount: missing.length,
        daysSinceEnrollment: daysElapsed,
        isBlocked,
        isUrgent,
      };
    });

    return warnings;
  },

  async getOfficeSettings() {
    const setting = await collections.settings().findOne({ key: 'office_locations' });
    return setting?.value || [];
  },

  async updateOfficeSettings(data: { name: string; lat: number; lng: number; radiusMetres: number }, userId: string) {
    await collections.settings().updateOne(
      { key: 'office_locations' },
      {
        $set: {
          key: 'office_locations',
          value: [data],
          updatedBy: toObjectId(userId),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return { ok: true as const };
  },

  async getAttendanceSettings() {
    const setting = await collections.settings().findOne({ key: 'attendance_allowed_roles' });
    return setting?.value || { roles: ['employee', 'hr'] };
  },

  async updateAttendanceSettings(data: { roles: string[] }, userId: string) {
    await collections.settings().updateOne(
      { key: 'attendance_allowed_roles' },
      {
        $set: {
          key: 'attendance_allowed_roles',
          value: data,
          updatedBy: toObjectId(userId),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return { ok: true as const };
  },

  async getPayrollPeriodSettings() {
    const setting = await collections.settings().findOne({ key: 'payroll_period' });
    return setting?.value || { startDay: 1, endDay: 30 };
  },

  async updatePayrollPeriodSettings(data: { startDay: number; endDay: number }, userId: string) {
    await collections.settings().updateOne(
      { key: 'payroll_period' },
      {
        $set: {
          key: 'payroll_period',
          value: data,
          updatedBy: toObjectId(userId),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return { ok: true as const };
  },

  async getPunchSelfies(dateStr?: string) {
    let targetDate: Date;
    if (dateStr) {
      targetDate = new Date(dateStr);
      targetDate = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()));
    } else {
      targetDate = utcMidnight();
    }

    const records = await collections.attendances()
      .aggregate([
        { $match: { date: targetDate } },
        {
          $lookup: {
            from: 'employees',
            localField: 'employee',
            foreignField: '_id',
            as: 'employee',
          },
        },
        { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'users',
            localField: 'employee.user',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      ])
      .toArray();

    const results = [];
    for (const record of records) {
      const employeeName = record.employee?.name || 'Unknown';

      if (record.punchIn?.selfieUrl) {
        results.push({
          employeeName,
          empId: record.employee?.empId,
          type: 'punch_in',
          selfieUrl: record.punchIn.selfieUrl,
          time: record.punchIn.time,
          location: record.punchIn.location,
          withinGeofence: record.punchIn.withinGeofence,
        });
      }
      if (record.punchOut?.selfieUrl) {
        results.push({
          employeeName,
          empId: record.employee?.empId,
          type: 'punch_out',
          selfieUrl: record.punchOut.selfieUrl,
          time: record.punchOut.time,
          location: record.punchOut.location,
          withinGeofence: record.punchOut.withinGeofence,
        });
      }
    }

    return results;
  },
};
