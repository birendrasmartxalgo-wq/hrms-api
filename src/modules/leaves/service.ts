import { ObjectId, type Filter } from 'mongodb';
import { collections } from '../../db/collections';
import type { EmployeeDocument } from '../../db/types/Employee';
import type {
  LeaveQuestion,
  LeaveRequestDocument,
  LeaveRequestStatus,
  LeaveTypeEnum,
} from '../../db/types/Leave';
import type { UserRole } from '../../db/types/User';
import type { AuthUser } from '../../plugins/auth';
import { ApiError, forbidden, unauthorized } from '../../errors';
import { buildUploadKey, putObject } from '../../services/s3';
import { notifyAll, notifyEmployee } from '../../services/notify';

type Actor = {
  userId: ObjectId;
  employeeId: ObjectId;
  role: UserRole;
};

type EmployeeLite = {
  _id: ObjectId;
  name?: string;
  empId?: string;
  designation?: string;
  department?: unknown;
  avatar?: string | null;
};

function objectId(value: string | ObjectId | undefined, field = 'id') {
  if (value instanceof ObjectId) return value;
  if (!value || !ObjectId.isValid(value)) {
    throw new ApiError(422, 'INVALID_OBJECT_ID', `${field} is not a valid ObjectId`);
  }

  return new ObjectId(value);
}

function dateFrom(value: string, field: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(422, 'INVALID_DATE', `${field} must be a valid date`);
  }

  return date;
}

async function requireActor(user: AuthUser | null | undefined): Promise<Actor> {
  if (!user) throw unauthorized('No token provided');

  const record = await collections
    .users()
    .findOne({ _id: objectId(user.userId, 'userId') }, { projection: { employee: 1, role: 1 } });

  if (!record?.employee) {
    throw new ApiError(400, 'NO_EMPLOYEE_PROFILE', 'No employee profile linked to this account');
  }

  return {
    userId: record._id,
    employeeId: record.employee,
    role: record.role,
  };
}

function requireAdminHr(actor: Actor) {
  if (actor.role !== 'admin' && actor.role !== 'hr') {
    throw forbidden();
  }
}

function countWorkingDays(start: Date, end: Date) {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(23, 59, 59, 999);

  while (cur <= endDate) {
    if (cur.getDay() !== 0) count += 1;
    cur.setDate(cur.getDate() + 1);
  }

  return count;
}

function computeLeaveBalance(dateOfJoining: Date | undefined, approvedLeaves: LeaveRequestDocument[], now = new Date()) {
  const joinDate = dateOfJoining ? new Date(dateOfJoining) : new Date(now.getFullYear(), 0, 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const accrualStart =
    joinDate > yearStart ? new Date(joinDate.getFullYear(), joinDate.getMonth(), 1) : yearStart;
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let balance = 0;
  const month = new Date(accrualStart);
  while (month <= currentMonthStart) {
    balance += 1.5;
    const y = month.getFullYear();
    const m = month.getMonth();
    const taken = approvedLeaves
      .filter((leave) => {
        const d = new Date(leave.startDate);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .reduce((sum, leave) => sum + (leave.totalDays || 0), 0);

    balance = Math.max(0, balance - taken);
    const next = new Date(y, m + 1, 1);
    if (next <= currentMonthStart) balance = Math.min(balance, 1.5);
    month.setMonth(month.getMonth() + 1);
  }

  return +balance.toFixed(1);
}

function monthlyBreakdown(approvedLeaves: LeaveRequestDocument[]) {
  const monthly: Record<number, number> = {};
  for (let m = 0; m < 12; m += 1) {
    monthly[m] = +approvedLeaves
      .filter((leave) => new Date(leave.startDate).getMonth() === m)
      .reduce((sum, leave) => sum + (leave.totalDays || 0), 0)
      .toFixed(1);
  }

  return monthly;
}

async function employeesById(ids: ObjectId[]) {
  const unique = [...new Map(ids.filter(Boolean).map((id) => [id.toString(), id])).values()];
  if (unique.length === 0) return new Map<string, EmployeeLite>();

  const employees = await collections
    .employees()
    .aggregate<EmployeeLite>([
      { $match: { _id: { $in: unique } } },
      {
        $lookup: {
          from: 'departments',
          localField: 'department',
          foreignField: '_id',
          as: 'departmentObj',
        },
      },
      { $unwind: { path: '$departmentObj', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1,
          empId: 1,
          designation: 1,
          avatar: 1,
          department: { _id: '$departmentObj._id', name: '$departmentObj.name', code: '$departmentObj.code' },
        },
      },
    ])
    .toArray();

  return new Map(employees.map((employee) => [employee._id.toString(), employee]));
}

function employeeRef(map: Map<string, EmployeeLite>, id: ObjectId | undefined) {
  if (!id) return id;
  return map.get(id.toString()) ?? id;
}

async function hydrateLeaves(leaves: LeaveRequestDocument[]) {
  const ids: ObjectId[] = [];
  for (const leave of leaves) {
    ids.push(leave.employee);
    if (leave.approver) ids.push(leave.approver);
    leave.statusHistory?.forEach((entry) => entry.changedBy && ids.push(entry.changedBy));
    leave.questions?.forEach((question) => {
      ids.push(question.askedBy);
      if (question.reply?.repliedBy) ids.push(question.reply.repliedBy);
    });
  }

  const map = await employeesById(ids);

  return leaves.map((leave) => ({
    ...leave,
    employee: employeeRef(map, leave.employee),
    approver: employeeRef(map, leave.approver),
    statusHistory: leave.statusHistory?.map((entry) => ({
      ...entry,
      changedBy: employeeRef(map, entry.changedBy),
    })),
    questions: leave.questions?.map((question) => ({
      ...question,
      askedBy: employeeRef(map, question.askedBy),
      reply: question.reply
        ? {
            ...question.reply,
            repliedBy: employeeRef(map, question.reply.repliedBy),
          }
        : question.reply,
    })),
  }));
}

async function findLeave(id: string) {
  const leave = await collections.leaveRequests().findOne({ _id: objectId(id) });
  if (!leave) throw new ApiError(404, 'LEAVE_NOT_FOUND', 'Leave not found');
  return leave;
}

async function ensureHrCanAct(actor: Actor, leave: LeaveRequestDocument, verb: string) {
  if (actor.role !== 'hr') return;

  const applicant = await collections.users().findOne({ employee: leave.employee }, { projection: { role: 1 } });
  if (applicant?.role === 'hr' || applicant?.role === 'admin') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      `HR Executive can only ${verb} employee leave requests.`,
    );
  }
}

async function updateStatus(
  id: string,
  actor: Actor,
  status: LeaveRequestStatus,
  remarks: string,
  extra: Record<string, unknown> = {},
) {
  const now = new Date();
  const updated = await collections.leaveRequests().findOneAndUpdate(
    { _id: objectId(id) },
    {
      $set: { status, updatedAt: now, ...extra },
      $push: {
        statusHistory: {
          status,
          changedBy: actor.employeeId,
          changedByRole: actor.role,
          changedAt: now,
          remarks,
        },
      },
    },
    { returnDocument: 'after' },
  );

  if (!updated) throw new ApiError(404, 'LEAVE_NOT_FOUND', 'Leave not found');
  return updated;
}

export const LeaveService = {
  async apply(user: AuthUser | null | undefined, input: {
    leaveType: LeaveTypeEnum;
    startDate: string;
    endDate: string;
    halfDay?: boolean;
    halfDayPeriod?: 'morning' | 'afternoon';
    reason: string;
  }) {
    const actor = await requireActor(user);
    const startDate = dateFrom(input.startDate, 'startDate');
    const endDate = dateFrom(input.endDate, 'endDate');
    const totalDays = input.halfDay ? 0.5 : countWorkingDays(startDate, endDate);

    if (totalDays <= 0) {
      throw new ApiError(400, 'INVALID_DATE_RANGE', 'Invalid date range - no working days selected');
    }

    const now = new Date();
    const leave: LeaveRequestDocument = {
      _id: new ObjectId(),
      employee: actor.employeeId,
      leaveType: input.leaveType,
      startDate,
      endDate,
      totalDays,
      halfDay: !!input.halfDay,
      halfDayPeriod: input.halfDay ? input.halfDayPeriod : undefined,
      reason: input.reason,
      attachments: [],
      questions: [],
      status: 'pending',
      statusHistory: [
        {
          status: 'pending',
          changedBy: actor.employeeId,
          changedByRole: actor.role,
          changedAt: now,
          remarks: 'Leave applied',
        },
      ],
      isLOP: false,
      lopDays: 0,
      createdAt: now,
      updatedAt: now,
    };

    await collections.leaveRequests().insertOne(leave);

    const [populated] = await hydrateLeaves([leave]);
    await notifyAll(
      {
        title: 'New Leave Request',
        body: `${(populated.employee as EmployeeLite)?.name ?? 'An employee'} applied for ${leave.leaveType} leave (${totalDays} day${totalDays !== 1 ? 's' : ''}).`,
        type: 'leave',
        link: '/leaves',
      },
      actor.employeeId,
    );

    return populated;
  },

  async my(user: AuthUser | null | undefined) {
    const actor = await requireActor(user);
    const leaves = await collections
      .leaveRequests()
      .find({ employee: actor.employeeId })
      .sort({ createdAt: -1 })
      .toArray();
    return hydrateLeaves(leaves);
  },

  async pending(user: AuthUser | null | undefined) {
    const actor = await requireActor(user);
    requireAdminHr(actor);

    let filter: Filter<LeaveRequestDocument> = { status: 'pending' };
    if (actor.role === 'hr') {
      const employeeUsers = await collections
        .users()
        .find({ role: 'employee' })
        .project<{ employee?: ObjectId }>({ employee: 1 })
        .toArray();
      filter = { ...filter, employee: { $in: employeeUsers.map((u) => u.employee).filter(Boolean) as ObjectId[] } };
    }

    const leaves = await collections.leaveRequests().find(filter).sort({ createdAt: -1 }).toArray();
    return hydrateLeaves(leaves);
  },

  async all(user: AuthUser | null | undefined, query: { status?: LeaveRequestStatus; employeeId?: string }) {
    const actor = await requireActor(user);
    requireAdminHr(actor);

    const filter: Filter<LeaveRequestDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.employeeId) filter.employee = objectId(query.employeeId, 'employeeId');

    const leaves = await collections.leaveRequests().find(filter).sort({ createdAt: -1 }).toArray();
    return hydrateLeaves(leaves);
  },

  async approve(user: AuthUser | null | undefined, id: string, remarks = '') {
    const actor = await requireActor(user);
    requireAdminHr(actor);

    const leave = await findLeave(id);
    if (leave.status !== 'pending') throw new ApiError(400, 'LEAVE_NOT_PENDING', 'Leave is not pending');
    await ensureHrCanAct(actor, leave, 'approve');

    const updated = await updateStatus(id, actor, 'approved', remarks, {
      approver: actor.employeeId,
      approvedAt: new Date(),
      approverRemarks: remarks,
    });

    await notifyEmployee(leave.employee, {
      title: 'Leave Approved',
      body: `Your ${leave.leaveType} leave request has been approved.`,
      type: 'leave',
      link: '/leaves',
    });

    return (await hydrateLeaves([updated]))[0];
  },

  async reject(user: AuthUser | null | undefined, id: string, remarks: string) {
    if (!remarks?.trim()) throw new ApiError(400, 'REMARKS_REQUIRED', 'Remarks are required for rejection');
    const actor = await requireActor(user);
    requireAdminHr(actor);

    const leave = await findLeave(id);
    if (leave.status !== 'pending') throw new ApiError(400, 'LEAVE_NOT_PENDING', 'Leave is not pending');
    await ensureHrCanAct(actor, leave, 'reject');

    const updated = await updateStatus(id, actor, 'rejected', remarks.trim(), {
      approver: actor.employeeId,
      rejectedAt: new Date(),
      approverRemarks: remarks.trim(),
    });

    await notifyEmployee(leave.employee, {
      title: 'Leave Rejected',
      body: `Your ${leave.leaveType} leave request was rejected. Reason: ${remarks.trim()}`,
      type: 'leave',
      link: '/leaves',
    });

    return (await hydrateLeaves([updated]))[0];
  },

  async withdraw(user: AuthUser | null | undefined, id: string) {
    const actor = await requireActor(user);
    const leave = await findLeave(id);

    if (!leave.employee.equals(actor.employeeId)) throw forbidden('Not your leave request');
    if (leave.status !== 'approved') throw new ApiError(400, 'INVALID_LEAVE_STATUS', 'Only approved leaves can be withdrawn');
    if (!leave.approvedAt) throw new ApiError(400, 'INVALID_LEAVE_STATUS', 'Leave does not have an approval timestamp');

    const elapsed = Date.now() - new Date(leave.approvedAt).getTime();
    if (elapsed > 6 * 60 * 60 * 1000) {
      throw new ApiError(400, 'WITHDRAWAL_EXPIRED', 'Withdrawal window has expired (6 hours after approval)');
    }

    await updateStatus(id, actor, 'withdrawn', 'Withdrawn by employee within 6-hour window');
  },

  async cancel(user: AuthUser | null | undefined, id: string) {
    const actor = await requireActor(user);
    const leave = await findLeave(id);

    if (!leave.employee.equals(actor.employeeId)) throw forbidden('Not your leave request');
    if (leave.status !== 'pending') throw new ApiError(400, 'INVALID_LEAVE_STATUS', 'Only pending leaves can be cancelled');

    await updateStatus(id, actor, 'cancelled', 'Cancelled by employee');
  },

  async adminCancel(user: AuthUser | null | undefined, id: string, remarks: string) {
    if (!remarks?.trim()) throw new ApiError(400, 'REMARKS_REQUIRED', 'Reason for cancellation is required');
    const actor = await requireActor(user);
    requireAdminHr(actor);

    const leave = await findLeave(id);
    if (leave.status && ['cancelled', 'withdrawn', 'rejected'].includes(leave.status)) {
      throw new ApiError(400, 'INVALID_LEAVE_STATUS', `Leave is already ${leave.status}`);
    }

    const updated = await updateStatus(id, actor, 'cancelled', remarks.trim());
    await notifyEmployee(leave.employee, {
      title: 'Leave Cancelled',
      body: `Your ${leave.leaveType} leave has been cancelled by ${actor.role === 'admin' ? 'Admin' : 'HR'}. Reason: ${remarks.trim()}`,
      type: 'leave',
      link: '/leaves',
    });

    return (await hydrateLeaves([updated]))[0];
  },

  async askQuestion(user: AuthUser | null | undefined, id: string, text: string) {
    if (!text?.trim()) throw new ApiError(400, 'QUESTION_REQUIRED', 'Question text is required');
    const actor = await requireActor(user);
    requireAdminHr(actor);

    const question = {
      _id: new ObjectId(),
      askedBy: actor.employeeId,
      askedByRole: actor.role,
      text: text.trim(),
      askedAt: new Date(),
    };

    const updated = await collections.leaveRequests().findOneAndUpdate(
      { _id: objectId(id) },
      { $push: { questions: question }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new ApiError(404, 'LEAVE_NOT_FOUND', 'Leave not found');

    await notifyEmployee(updated.employee, {
      title: 'Question on your leave request',
      body: `${actor.role === 'admin' ? 'Admin' : 'HR'} has a question about your ${updated.leaveType} leave. Please reply.`,
      type: 'leave',
      link: '/leaves',
    });

    return (await hydrateLeaves([updated]))[0];
  },

  async replyToQuestion(user: AuthUser | null | undefined, id: string, qid: string, text: string) {
    if (!text?.trim()) throw new ApiError(400, 'REPLY_REQUIRED', 'Reply text is required');
    const actor = await requireActor(user);
    const leave = await findLeave(id);
    const isAdminHr = actor.role === 'admin' || actor.role === 'hr';
    if (!isAdminHr && !leave.employee.equals(actor.employeeId)) throw forbidden('Not your leave request');

    const question = (leave.questions ?? []).find((q) => q._id?.toString() === qid);
    if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Question not found');
    if (question.reply?.text) throw new ApiError(400, 'QUESTION_ALREADY_REPLIED', 'Question already has a reply');

    const updated = await collections.leaveRequests().findOneAndUpdate(
      { _id: leave._id, 'questions._id': objectId(qid, 'qid') },
      {
        $set: {
          'questions.$.reply': {
            text: text.trim(),
            repliedBy: actor.employeeId,
            repliedAt: new Date(),
          },
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Question not found');

    if (!isAdminHr) {
      await notifyEmployee(question.askedBy, {
        title: 'Reply received on leave query',
        body: 'Employee has replied to your question on a leave request.',
        type: 'leave',
        link: '/leaves',
      });
    }

    return (await hydrateLeaves([updated]))[0];
  },

  async uploadAttachment(user: AuthUser | null | undefined, id: string, file: File) {
    const actor = await requireActor(user);
    const leave = await findLeave(id);
    const isAdminHr = actor.role === 'admin' || actor.role === 'hr';
    if (!isAdminHr && !leave.employee.equals(actor.employeeId)) throw forbidden('Not your leave request');

    const key = buildUploadKey(
      {
        purpose: 'leave',
        leaveId: leave._id.toString(),
        filename: file.name || 'attachment.bin',
        contentType: file.type || 'application/octet-stream',
      },
      { actorEmployeeId: actor.employeeId.toString() },
    );
    const body = new Uint8Array(await file.arrayBuffer());
    await putObject(key, body, file.type || 'application/octet-stream', { contentLength: body.byteLength });

    const attachment = {
      key,
      url: key,
      name: file.name || key.split('/').at(-1) || 'attachment',
      contentType: file.type || 'application/octet-stream',
      uploadedAt: new Date(),
    };

    const updated = await collections.leaveRequests().findOneAndUpdate(
      { _id: leave._id },
      { $push: { attachments: attachment }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new ApiError(404, 'LEAVE_NOT_FOUND', 'Leave not found');

    return { attachment, leave: updated };
  },

  async myBalance(user: AuthUser | null | undefined) {
    const actor = await requireActor(user);
    return this.employeeBalance(actor.employeeId.toString());
  },

  async employeeBalance(employeeId: string) {
    const emp = await collections.employees().findOne({ _id: objectId(employeeId, 'employeeId') });
    if (!emp) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const leaves = await collections
      .leaveRequests()
      .find({ employee: emp._id, status: 'approved', startDate: { $gte: yearStart } })
      .toArray();
    const balance = computeLeaveBalance(emp.dateOfJoining, leaves, now);
    const totalTaken = +leaves.reduce((sum, leave) => sum + (leave.totalDays || 0), 0).toFixed(1);

    return {
      balance,
      totalTaken,
      totalAccrued: +(balance + totalTaken).toFixed(1),
      monthly: monthlyBreakdown(leaves),
      year: now.getFullYear(),
    };
  },

  async summary(user: AuthUser | null | undefined) {
    const actor = await requireActor(user);
    requireAdminHr(actor);

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const employees = await collections
      .employees()
      .find({ isActive: { $ne: false } })
      .project<EmployeeDocument>({ name: 1, empId: 1, designation: 1, department: 1, dateOfJoining: 1, avatar: 1 })
      .toArray();
    const leaves = await collections
      .leaveRequests()
      .find({ status: 'approved', startDate: { $gte: yearStart } })
      .toArray();
    const departments = await collections.departments().find().project({ name: 1 }).toArray();
    const deptMap = new Map(departments.map((dept) => [dept._id.toString(), dept.name]));

    return {
      data: employees.map((emp) => {
        const empLeaves = leaves.filter((leave) => leave.employee.equals(emp._id));
        const balance = computeLeaveBalance(emp.dateOfJoining, empLeaves, now);
        return {
          _id: emp._id,
          name: emp.name,
          empId: emp.empId,
          designation: emp.designation,
          department: emp.department ? deptMap.get(emp.department.toString()) : undefined,
          avatar: emp.avatar || null,
          balance,
          totalTaken: +empLeaves.reduce((sum, leave) => sum + (leave.totalDays || 0), 0).toFixed(1),
          monthly: monthlyBreakdown(empLeaves),
        };
      }),
      year: now.getFullYear(),
    };
  },
};
