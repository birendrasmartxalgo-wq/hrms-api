import { Elysia } from 'elysia';
import { AttendanceSchemas } from './schema';
import { AttendanceService } from './service';
import { collections } from '../../db/collections';
import { ObjectId } from 'mongodb';
import { authPlugin } from '../../plugins/auth';
import { checkGeofenceAsync } from '../../services/geofence';
import { putObject, buildUploadKey } from '../../services/s3';

const OFFICE_START_HOUR = 8.5;
const OFFICE_END_HOUR   = 17.5;
const HALF_DAY_HOURS    = 4;
const LATE_CUTOFF_MINS  = 8 * 60 + 45;
const EARLY_LEAVE_MINS  = 16 * 60 + 30;

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const attendanceController = new Elysia({ prefix: '/attendance' })
  .use(authPlugin)
  .guard({ authorize: true as const }, app => app

  .post('/punch-in', async ({ user, body, set, request }) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    
    // Front-end rule enforced in backend
    if (user.role === 'admin' || user.role === 'hr') {
      set.status = 403;
      return { message: 'Admins/HR cannot punch in/out' };
    }

    const access = await AttendanceService.checkAttendanceAccess(user);
    if (access.blocked) {
      set.status = 403;
      return { message: access.message, code: 'ACCESS_DENIED' };
    }

    const today = todayMidnight();
    const { skip, reason } = await AttendanceService.isHolidayOrWeekend(today);
    if (skip) {
      set.status = 400;
      return { message: `Cannot punch in on ${reason}` };
    }

    const employeeId = new ObjectId(user.employeeId);
    
    const existing = await collections.attendances().findOne({ employee: employeeId, date: today });
    if (existing?.punchIn && existing?.punchOut) {
      // Repunch flow omitted for brevity in punch-in, handled natively in controller port
      const pendingReq = await collections.repunchRequests().findOne({ employee: employeeId, date: today, status: 'pending' });
      if (pendingReq) {
        set.status = 400;
        return { message: 'Your re-punch-in request is already pending admin approval.', code: 'REPUNCH_PENDING' };
      }
      const approvedReq = await collections.repunchRequests().findOne({ employee: employeeId, date: today, status: 'approved' });
      if (approvedReq) {
        set.status = 400;
        return { message: 'Your re-punch-in has been approved. Please refresh and punch in.', code: 'REPUNCH_APPROVED' };
      }

      let selfieKey = 'no-selfie';
      if (body.selfie) {
        selfieKey = buildUploadKey({ purpose: 'selfie', contentType: body.selfie.type, employeeId: user.employeeId });
        await putObject(selfieKey, Buffer.from(await body.selfie.arrayBuffer()), body.selfie.type);
      } else if (body.selfieKey) {
        selfieKey = body.selfieKey;
      }

      const repunchReq = await collections.repunchRequests().insertOne({
        _id: new ObjectId(),
        employee: employeeId,
        attendance: existing._id,
        date: today,
        location: { lat: body.lat, lng: body.lng, accuracy: body.accuracy || 0, ip: '' },
        selfieUrl: selfieKey,
        status: 'pending',
        requestedAt: new Date()
      });

      set.status = 202;
      return { message: 'Re-punch-in request submitted. Waiting for admin approval.', code: 'REPUNCH_REQUESTED', requestId: repunchReq.insertedId };
    }

    if (existing?.punchIn) {
      set.status = 400;
      return { message: 'Already punched in today' };
    }

    const onLeaveToday = await collections.leaveRequests().findOne({
      employee: employeeId,
      status: 'approved',
      startDate: { $lte: today },
      endDate: { $gte: today }
    });
    if (onLeaveToday) {
      set.status = 403;
      return { message: `You are on approved ${onLeaveToday.leaveType} leave today. Punch-in is not allowed.`, code: 'ON_LEAVE' };
    }

    const geo = await checkGeofenceAsync(body.lat, body.lng);
    if (!geo.withinGeofence) {
      set.status = 422;
      return { message: 'Punch in location is outside the allowed office geofence', code: 'OUTSIDE_GEOFENCE' };
    }

    const nowIST = new Date();
    const istTotalMinutes = ((nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes()) + 330) % 1440;
    const isLate = istTotalMinutes > LATE_CUTOFF_MINS;

    let selfieKey = 'no-selfie';
    if (body.selfie) {
      selfieKey = buildUploadKey({ purpose: 'selfie', contentType: body.selfie.type, employeeId: user.employeeId });
      await putObject(selfieKey, Buffer.from(await body.selfie.arrayBuffer()), body.selfie.type);
    } else if (body.selfieKey) {
      // Client uploaded directly to S3 via presigned PUT; trust the key.
      selfieKey = body.selfieKey;
    }

    const punchInData = {
      time: nowIST,
      location: { lat: body.lat, lng: body.lng, accuracy: body.accuracy || 0, ip: '' },
      selfieUrl: selfieKey,
      selfiePublicId: undefined,
      withinGeofence: geo.withinGeofence,
      distanceFromOffice: geo.distanceFromOffice
    };

    const attendance = await collections.attendances().findOneAndUpdate(
      { employee: employeeId, date: today },
      { 
        $set: { 
          punchIn: punchInData, 
          status: 'present', 
          isLate, 
          source: (body.source || 'web') as import('../../db/types/Attendance').AttendanceSource
        },
        $setOnInsert: {
          employee: employeeId,
          date: today,
          breaks: [],
          totalWorkingMinutes: 0,
          totalBreakMinutes: 0,
          netWorkingMinutes: 0,
          isEarlyLeave: false,
          isOvertime: false,
          isRegularized: false
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    return {
      message: isLate ? 'Punched in (late)' : 'Punched in successfully',
      attendance,
      geofence: geo
    };
  }, AttendanceSchemas.Punch)

  .post('/punch-out', async ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (user.role === 'admin' || user.role === 'hr') {
      set.status = 403;
      return { message: 'Admins/HR cannot punch in/out' };
    }

    const access = await AttendanceService.checkAttendanceAccess(user);
    if (access.blocked) {
      set.status = 403;
      return { message: access.message, code: 'ACCESS_DENIED' };
    }

    const employeeId = new ObjectId(user.employeeId);
    const today = todayMidnight();

    const onLeaveToday = await collections.leaveRequests().findOne({
      employee: employeeId,
      status: 'approved',
      startDate: { $lte: today },
      endDate: { $gte: today }
    });
    if (onLeaveToday) {
      set.status = 403;
      return { message: `You are on approved ${onLeaveToday.leaveType} leave today. Punch-out is not allowed.`, code: 'ON_LEAVE' };
    }

    const attendance = await collections.attendances().findOne({ employee: employeeId, date: today });
    if (!attendance?.punchIn) {
      set.status = 400;
      return { message: 'You have not punched in today' };
    }
    if (attendance.punchOut) {
      set.status = 400;
      return { message: 'Already punched out today' };
    }

    const openBreak = (attendance.breaks || []).find((b: any) => !b.endTime);
    if (openBreak) {
      openBreak.endTime = new Date();
      openBreak.durationMinutes = Math.floor((new Date().getTime() - openBreak.startTime.getTime()) / 60000);
      if (body.lat && body.lng) {
        openBreak.endLocation = { lat: body.lat, lng: body.lng, ip: '' };
      }
    }

    const geo = await checkGeofenceAsync(body.lat, body.lng);
    if (!geo.withinGeofence) {
      set.status = 422;
      return { message: 'Punch out location is outside the allowed office geofence', code: 'OUTSIDE_GEOFENCE' };
    }

    const nowIST = new Date();
    const totalWorkingMinutes = AttendanceService.calcWorkingMinutes(attendance.punchIn.time, nowIST);
    const totalBreakMinutes = AttendanceService.calcBreakMinutes(attendance.breaks || []);
    const netWorkingMinutes = Math.max(totalWorkingMinutes - totalBreakMinutes, 0);

    const istTotalMins2 = ((nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes()) + 330) % 1440;
    const isEarlyLeave = istTotalMins2 < EARLY_LEAVE_MINS;
    const isOvertime = netWorkingMinutes > (OFFICE_END_HOUR - OFFICE_START_HOUR) * 60 + 30;
    const isHalfDay = netWorkingMinutes < HALF_DAY_HOURS * 60;

    let selfieKey = 'no-selfie';
    if (body.selfie) {
      selfieKey = buildUploadKey({ purpose: 'selfie', contentType: body.selfie.type, employeeId: user.employeeId });
      await putObject(selfieKey, Buffer.from(await body.selfie.arrayBuffer()), body.selfie.type);
    } else if (body.selfieKey) {
      selfieKey = body.selfieKey;
    }

    const updated = await collections.attendances().findOneAndUpdate(
      { employee: employeeId, date: today },
      {
        $set: {
          punchOut: {
            time: nowIST,
            location: { lat: body.lat, lng: body.lng, accuracy: body.accuracy || 0, ip: '' },
            selfieUrl: selfieKey,
            selfiePublicId: undefined,
            withinGeofence: geo.withinGeofence,
            distanceFromOffice: geo.distanceFromOffice
          },
          breaks: attendance.breaks,
          totalWorkingMinutes,
          totalBreakMinutes,
          netWorkingMinutes,
          isEarlyLeave,
          isOvertime,
          status: isHalfDay ? 'half_day' : 'present'
        }
      },
      { returnDocument: 'after' }
    );

    return { message: 'Punched out successfully', attendance: updated, geofence: geo };
  }, AttendanceSchemas.Punch)

  .post('/break/start', async ({ user, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    
    const employeeId = new ObjectId(user.employeeId);
    const today = todayMidnight();
    const attendance = await collections.attendances().findOne({ employee: employeeId, date: today });
    if (!attendance?.punchIn) { set.status = 400; return { message: 'Not punched in' }; }
    if (attendance.punchOut) { set.status = 400; return { message: 'Already punched out' }; }
    if ((attendance.breaks || []).some((b: any) => !b.endTime)) {
      set.status = 400;
      return { message: 'A break is already in progress' };
    }

    const newBreak = {
      startTime: new Date(),
      startLocation: body.lat && body.lng ? { lat: body.lat, lng: body.lng, ip: '' } : undefined,
      type: body.type || 'other'
    };

    await collections.attendances().updateOne(
      { _id: attendance._id },
      { $push: { breaks: newBreak } as any }
    );

    return { message: 'Break started', break: newBreak };
  }, AttendanceSchemas.StartBreak)

  .post('/break/end', async ({ user, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }

    const employeeId = new ObjectId(user.employeeId);
    const today = todayMidnight();
    const attendance = await collections.attendances().findOne({ employee: employeeId, date: today });
    const breaks = attendance?.breaks || [];
    const openBreakIndex = breaks.findIndex((b: any) => !b.endTime);
    if (openBreakIndex === -1) {
      set.status = 400;
      return { message: 'No active break found' };
    }

    const openBreak = breaks[openBreakIndex];
    openBreak.endTime = new Date();
    openBreak.durationMinutes = Math.floor((openBreak.endTime.getTime() - openBreak.startTime.getTime()) / 60000);
    if (body.lat && body.lng) {
      openBreak.endLocation = { lat: body.lat, lng: body.lng, ip: '' };
    }

    await collections.attendances().updateOne(
      { _id: attendance!._id },
      { $set: { breaks } }
    );

    return { message: `Break ended (${openBreak.durationMinutes} min)`, break: openBreak };
  }, AttendanceSchemas.EndBreak)

  .get('/today', async ({ user, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const employeeId = new ObjectId(user.employeeId);
    const today = todayMidnight();
    const attendance = await collections.attendances().findOne({ employee: employeeId, date: today });

    const openBreak = (attendance?.breaks || []).find((b: any) => !b.endTime);
    const currentBreakMinutes = openBreak ? Math.floor((new Date().getTime() - openBreak.startTime.getTime()) / 60000) : 0;

    return { attendance, onBreak: !!openBreak, currentBreakMinutes };
  })

  // Remaining Endpoints
  .get('/monthly', async ({ user, query, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    
    const employeeId = new ObjectId(user.employeeId);
    const month = parseInt(query.month || (new Date().getMonth() + 1).toString());
    const year = parseInt(query.year || new Date().getFullYear().toString());

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const records = await collections.attendances().find({ employee: employeeId, date: { $gte: start, $lte: end } }).sort({ date: 1 }).toArray();

    const todayStr = new Date().toDateString();
    const calcNetMins = (r: any) => {
      if (r.netWorkingMinutes > 0) return r.netWorkingMinutes;
      if (r.punchIn?.time && !r.punchOut?.time) {
        const recDateStr = new Date(r.date).toDateString();
        if (recDateStr !== todayStr) return 0;
        const breakTotal = (r.breaks || [])
          .filter((b: any) => b.endTime)
          .reduce((s: number, b: any) => s + (b.durationMinutes || 0), 0);
        return Math.max(0, Math.floor((Date.now() - new Date(r.punchIn.time).getTime()) / 60000) - breakTotal);
      }
      return 0;
    };

    const totalNetMinutes = records.reduce((sum, r) => sum + calcNetMins(r), 0);

    const leaveRequests = await collections.leaveRequests().find({
      employee: employeeId,
      status: 'approved',
      startDate: { $lte: end },
      endDate: { $gte: start }
    }).toArray();

    const leaveDays = [];
    for (const lv of leaveRequests) {
      const lvStart = new Date(Math.max(new Date(lv.startDate).getTime(), start.getTime()));
      const lvEnd = new Date(Math.min(new Date(lv.endDate).getTime(), end.getTime()));
      for (let d = new Date(lvStart); d <= lvEnd; d.setDate(d.getDate() + 1)) {
        leaveDays.push({
          date: new Date(d),
          leaveType: lv.leaveType,
          halfDay: lv.halfDay,
          halfDayPeriod: lv.halfDayPeriod
        });
      }
    }

    const summary = {
      present: records.filter(r => r.status === 'present').length,
      halfDay: records.filter(r => r.status === 'half_day').length,
      absent: records.filter(r => r.status === 'absent').length,
      late: records.filter(r => r.isLate).length,
      onLeave: leaveDays.length,
      totalNetMinutes,
      totalNetHours: totalNetMinutes
    };

    return { records, leaveDays, summary };
  })

  // GET /attendance/monthly-all — admin+hr team view. Returns per-employee
  // monthly summaries (one row per active employee). Shape mirrors
  // /leaves/summary so the client can render a similar grid.
  .get('/monthly-all', async ({ user, query, set }) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) {
      set.status = 403; return { message: 'Forbidden' };
    }

    const month = parseInt(query.month || (new Date().getMonth() + 1).toString());
    const year = parseInt(query.year || new Date().getFullYear().toString());
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const [employees, attendances, leaves, departments] = await Promise.all([
      collections.employees()
        .find({ isActive: { $ne: false } })
        .project({ name: 1, empId: 1, designation: 1, department: 1, avatar: 1 })
        .toArray(),
      collections.attendances()
        .find({ date: { $gte: start, $lte: end } })
        .toArray(),
      collections.leaveRequests()
        .find({ status: 'approved', startDate: { $lte: end }, endDate: { $gte: start } })
        .toArray(),
      collections.departments().find().project({ name: 1 }).toArray(),
    ]);

    const deptMap = new Map(departments.map((d: any) => [d._id.toString(), d.name]));

    const todayStr = new Date().toDateString();
    const calcNetMins = (r: any) => {
      if (r.netWorkingMinutes > 0) return r.netWorkingMinutes;
      if (r.punchIn?.time && !r.punchOut?.time) {
        const recDateStr = new Date(r.date).toDateString();
        if (recDateStr !== todayStr) return 0;
        const breakTotal = (r.breaks || [])
          .filter((b: any) => b.endTime)
          .reduce((s: number, b: any) => s + (b.durationMinutes || 0), 0);
        return Math.max(0, Math.floor((Date.now() - new Date(r.punchIn.time).getTime()) / 60000) - breakTotal);
      }
      return 0;
    };

    const data = employees.map((emp: any) => {
      const empAtt = attendances.filter((r: any) => r.employee.equals(emp._id));
      const empLeaves = leaves.filter((l: any) => l.employee.equals(emp._id));

      let onLeave = 0;
      for (const lv of empLeaves) {
        const lvStart = new Date(Math.max(new Date(lv.startDate).getTime(), start.getTime()));
        const lvEnd = new Date(Math.min(new Date(lv.endDate).getTime(), end.getTime()));
        for (let d = new Date(lvStart); d <= lvEnd; d.setDate(d.getDate() + 1)) onLeave++;
      }

      const totalNetMinutes = empAtt.reduce((sum: number, r: any) => sum + calcNetMins(r), 0);

      return {
        _id: emp._id,
        name: emp.name,
        empId: emp.empId,
        designation: emp.designation,
        department: emp.department ? deptMap.get(emp.department.toString()) : undefined,
        avatar: emp.avatar || null,
        summary: {
          present: empAtt.filter((r: any) => r.status === 'present').length,
          halfDay: empAtt.filter((r: any) => r.status === 'half_day').length,
          absent: empAtt.filter((r: any) => r.status === 'absent').length,
          late: empAtt.filter((r: any) => r.isLate).length,
          onLeave,
          totalNetMinutes,
          totalNetHours: totalNetMinutes,
        },
      };
    });

    return { data, month, year };
  })

  .get('/monthly/:empId', async ({ user, params, query, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    
    let employeeId: ObjectId;
    try {
      employeeId = new ObjectId(params.empId);
    } catch {
      set.status = 400; return { message: 'Invalid employee ID' };
    }

    const month = parseInt(query.month || (new Date().getMonth() + 1).toString());
    const year = parseInt(query.year || new Date().getFullYear().toString());

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const records = await collections.attendances().find({ employee: employeeId, date: { $gte: start, $lte: end } }).sort({ date: 1 }).toArray();

    const todayStr = new Date().toDateString();
    const calcNetMins = (r: any) => {
      if (r.netWorkingMinutes > 0) return r.netWorkingMinutes;
      if (r.punchIn?.time && !r.punchOut?.time) {
        const recDateStr = new Date(r.date).toDateString();
        if (recDateStr !== todayStr) return 0;
        const breakTotal = (r.breaks || [])
          .filter((b: any) => b.endTime)
          .reduce((s: number, b: any) => s + (b.durationMinutes || 0), 0);
        return Math.max(0, Math.floor((Date.now() - new Date(r.punchIn.time).getTime()) / 60000) - breakTotal);
      }
      return 0;
    };

    const totalNetMinutes = records.reduce((sum, r) => sum + calcNetMins(r), 0);

    const leaveRequests = await collections.leaveRequests().find({
      employee: employeeId,
      status: 'approved',
      startDate: { $lte: end },
      endDate: { $gte: start }
    }).toArray();

    const leaveDays = [];
    for (const lv of leaveRequests) {
      const lvStart = new Date(Math.max(new Date(lv.startDate).getTime(), start.getTime()));
      const lvEnd = new Date(Math.min(new Date(lv.endDate).getTime(), end.getTime()));
      for (let d = new Date(lvStart); d <= lvEnd; d.setDate(d.getDate() + 1)) {
        leaveDays.push({
          date: new Date(d),
          leaveType: lv.leaveType,
          halfDay: lv.halfDay,
          halfDayPeriod: lv.halfDayPeriod
        });
      }
    }

    const summary = {
      present: records.filter(r => r.status === 'present').length,
      halfDay: records.filter(r => r.status === 'half_day').length,
      absent: records.filter(r => r.status === 'absent').length,
      late: records.filter(r => r.isLate).length,
      onLeave: leaveDays.length,
      totalNetMinutes,
      totalNetHours: totalNetMinutes
    };

    return { records, leaveDays, summary };
  })

  .put('/regularize/:id', async ({ user, params, body, set }) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) {
      set.status = 403; return { message: 'Forbidden' };
    }

    const attendance = await collections.attendances().findOne({ _id: new ObjectId(params.id) });
    if (!attendance) { set.status = 404; return { message: 'Attendance record not found' }; }

    let updatedPunchIn = attendance.punchIn;
    let updatedPunchOut = attendance.punchOut;

    if (body.punchInTime && attendance.punchIn) updatedPunchIn = { ...attendance.punchIn, time: new Date(body.punchInTime) };
    if (body.punchOutTime && attendance.punchOut) updatedPunchOut = { ...attendance.punchOut, time: new Date(body.punchOutTime) };

    let totalWorkingMinutes = attendance.totalWorkingMinutes || 0;
    let totalBreakMinutes = attendance.totalBreakMinutes || 0;
    let netWorkingMinutes = attendance.netWorkingMinutes || 0;
    let status = attendance.status;

    if (updatedPunchIn && updatedPunchOut) {
      totalWorkingMinutes = AttendanceService.calcWorkingMinutes(updatedPunchIn.time, updatedPunchOut.time);
      totalBreakMinutes = AttendanceService.calcBreakMinutes(attendance.breaks || []);
      netWorkingMinutes = Math.max(totalWorkingMinutes - totalBreakMinutes, 0);
      status = netWorkingMinutes < HALF_DAY_HOURS * 60 ? 'half_day' : 'present';
    }

    const updated = await collections.attendances().findOneAndUpdate(
      { _id: attendance._id },
      {
        $set: {
          punchIn: updatedPunchIn,
          punchOut: updatedPunchOut,
          totalWorkingMinutes,
          totalBreakMinutes,
          netWorkingMinutes,
          status,
          isRegularized: true,
          regularizedBy: new ObjectId(user.userId),
          regularizationReason: body.reason,
          regularizedAt: new Date(),
          source: 'regularized'
        }
      },
      { returnDocument: 'after' }
    );

    return { message: 'Attendance regularized', attendance: updated };
  }, AttendanceSchemas.Regularize)

  .get('/repunch-requests', async ({ user, query, set }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) {
      set.status = 403; return { message: 'Forbidden' };
    }

    const allowed = ['pending', 'approved', 'rejected'];
    const status = allowed.includes(query?.status) ? query.status : 'pending';
    const limit = Math.min(Number(query?.limit) || 50, 200);

    const requests = await collections.repunchRequests().aggregate([
      { $match: { status } },
      { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: 'empObj' } },
      { $unwind: { path: '$empObj', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'attendances', localField: 'attendance', foreignField: '_id', as: 'attObj' } },
      { $unwind: { path: '$attObj', preserveNullAndEmptyArrays: true } },
      { $sort: { requestedAt: -1 } },
      { $limit: limit }
    ]).toArray();

    const data = requests.map(r => {
      if (r.empObj) {
        r.employee = { _id: r.empObj._id, name: r.empObj.name, empId: r.empObj.empId, avatar: r.empObj.avatar, department: r.empObj.department, designation: r.empObj.designation };
        delete r.empObj;
      }
      if (r.attObj) {
        r.attendance = { _id: r.attObj._id, punchIn: r.attObj.punchIn, punchOut: r.attObj.punchOut, date: r.attObj.date };
        delete r.attObj;
      }
      return r;
    });

    return { data };
  })

  .get('/repunch-status', async ({ user, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    
    const employeeId = new ObjectId(user.employeeId);
    const today = todayMidnight();
    const req = await collections.repunchRequests().findOne(
      { employee: employeeId, date: today },
      { sort: { requestedAt: -1 } }
    );

    return { data: req || null };
  })

  .patch('/repunch-requests/:id/approve', async ({ user, params, body, set }) => {
    if (!user || user.role !== 'admin') {
      set.status = 403; return { message: 'Forbidden' };
    }

    const repunchReq = await collections.repunchRequests().findOne({ _id: new ObjectId(params.id) });
    if (!repunchReq) { set.status = 404; return { message: 'Request not found' }; }
    if (repunchReq.status !== 'pending') { set.status = 400; return { message: `Request is already ${repunchReq.status}` }; }

    await collections.attendances().updateOne(
      { _id: repunchReq.attendance },
      {
        $unset: { punchOut: '' },
        $set: {
          status: 'present',
          isEarlyLeave: false,
          totalWorkingMinutes: 0,
          totalBreakMinutes: 0,
          netWorkingMinutes: 0
        }
      } as any
    );

    const updated = await collections.repunchRequests().findOneAndUpdate(
      { _id: repunchReq._id },
      {
        $set: {
          status: 'approved',
          approvedBy: new ObjectId(user.employeeId),
          approvedAt: new Date(),
          adminRemarks: body?.remarks || ''
        }
      },
      { returnDocument: 'after' }
    );

    return { message: 'Re-punch-in request approved. Employee can now punch in.', data: updated };
  }, AttendanceSchemas.RepunchApprove)

  .patch('/repunch-requests/:id/reject', async ({ user, params, body, set }) => {
    if (!user || user.role !== 'admin') {
      set.status = 403; return { message: 'Forbidden' };
    }

    const repunchReq = await collections.repunchRequests().findOne({ _id: new ObjectId(params.id) });
    if (!repunchReq) { set.status = 404; return { message: 'Request not found' }; }
    if (repunchReq.status !== 'pending') { set.status = 400; return { message: `Request is already ${repunchReq.status}` }; }

    const updated = await collections.repunchRequests().findOneAndUpdate(
      { _id: repunchReq._id },
      {
        $set: {
          status: 'rejected',
          rejectedBy: new ObjectId(user.employeeId),
          rejectedAt: new Date(),
          adminRemarks: body?.remarks || ''
        }
      },
      { returnDocument: 'after' }
    );

    return { message: 'Request rejected.', data: updated };
  }, AttendanceSchemas.RepunchApprove)

  .post('/activity-status', async ({ user, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    
    AttendanceService.activityMap.set(user.userId, {
      status: body.status,
      lastSeen: new Date()
    });
    return { ok: true };
  }, AttendanceSchemas.ActivityStatus)
  
  .get('/activity-statuses', async ({ user, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    if (user.role !== 'admin' && user.role !== 'hr') {
      set.status = 403; return { message: 'Forbidden' };
    }

    const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;
    const now = Date.now();
    const result = [];
    for (const [userId, entry] of AttendanceService.activityMap.entries()) {
      const msSinceSeen = now - new Date(entry.lastSeen).getTime();
      const effectiveStatus = msSinceSeen > OFFLINE_THRESHOLD_MS ? 'offline' : entry.status;
      result.push({
        userId,
        status: effectiveStatus,
        lastSeen: entry.lastSeen,
        idleSecs: effectiveStatus === 'idle' ? Math.floor(msSinceSeen / 1000) : null
      });
    }
    return result;
  }));
