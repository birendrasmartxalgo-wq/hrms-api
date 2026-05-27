import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import { UsersService } from '../users/service';
import { isValidObjectId, toObjectId, toObjectIdOrNull } from '../../utils/ids';
import { utcMidnight, datePartIST } from '../../utils/time';
import type { EmployeeDocument } from '../../db/types/Employee';
import type { DocumentType } from '../../db/types/Document';

const MANDATORY_DOC_TYPES: DocumentType[] = [
  'aadhar', 'pan', 'bank_details', 'qualification_cert',
  'nda', 'offer_letter', 'joining_letter',
];

const ALL_DOC_TYPES: DocumentType[] = [
  ...MANDATORY_DOC_TYPES, 'relieving_letter', 'police_verification',
];

export const EmployeesService = {
  async listEmployees(filters: {
    search?: string;
    department?: string;
    status?: string;
    employmentStatus?: string;
    onboardingStatus?: string;
    tab?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const match: any = {};

    if (filters.tab === 'active') {
      match.isActive = { $ne: false };
      match.employmentStatus = { $nin: ['former', 'inactive'] };
    } else if (filters.tab === 'inactive') {
      match.$or = [{ isActive: false }, { employmentStatus: 'inactive' }];
    } else if (filters.tab === 'former') {
      match.employmentStatus = 'former';
    } else if (filters.tab === 'all') {
      // no filter
    } else {
      match.isActive = { $ne: false };
      match.employmentStatus = { $nin: ['former', 'inactive'] };
    }

    if (filters.status) {
      match.employmentStatus = filters.status;
    }
    if (filters.employmentStatus) {
      match.employmentStatus = filters.employmentStatus;
    }
    if (filters.onboardingStatus) {
      match.onboardingStatus = filters.onboardingStatus;
    }
    if (filters.department && isValidObjectId(filters.department)) {
      match.department = toObjectId(filters.department);
    } else if (filters.department) {
      const dept = await collections.departments().findOne({
        $or: [{ code: filters.department.toUpperCase() }, { name: filters.department }],
      });
      if (dept) match.department = dept._id;
      else return { employees: [], total: 0, page, limit };
    }

    if (filters.search) {
      const regex = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [
        { name: regex },
        { empId: regex },
        { email: regex },
        { phone: regex },
      ];
    }

    const pipeline: any[] = [{ $match: match }];

    pipeline.push({
      $lookup: {
        from: 'departments',
        localField: 'department',
        foreignField: '_id',
        as: 'department',
      },
    });
    pipeline.push({
      $unwind: { path: '$department', preserveNullAndEmptyArrays: true },
    });

    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        pipeline: [{ $project: { password: 0, passwordResetOtpHash: 0, passwordResetTokenHash: 0 } }],
        as: 'user',
      },
    });
    pipeline.push({
      $unwind: { path: '$user', preserveNullAndEmptyArrays: true },
    });

    const todayStart = utcMidnight();
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCHours(23, 59, 59, 999);

    pipeline.push({
      $lookup: {
        from: 'attendances',
        let: { empId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$employee', '$$empId'] }, date: { $gte: todayStart, $lte: todayEnd } } },
          { $project: { status: 1 } },
          { $limit: 1 },
        ],
        as: '_todayAtt',
      },
    });
    pipeline.push({
      $addFields: {
        attendanceStatus: {
          $cond: {
            if: { $gt: [{ $size: '$_todayAtt' }, 0] },
            then: { $arrayElemAt: ['$_todayAtt.status', 0] },
            else: 'absent',
          },
        },
        // Mobile list rows render avatar + tap-to-call; guarantee these keys
        // exist on every row (null when unset) and expose avatarUrl alias.
        phone: { $ifNull: ['$phone', null] },
        avatar: { $ifNull: ['$avatar', null] },
        avatarUrl: { $ifNull: ['$avatar', null] },
      },
    });
    pipeline.push({ $project: { _todayAtt: 0 } });

    pipeline.push({ $sort: { createdAt: -1 } });

    const countPipeline = [...pipeline, { $count: 'total' }];
    pipeline.push({ $skip: skip }, { $limit: limit });

    const [employees, countResult] = await Promise.all([
      collections.employees().aggregate(pipeline).toArray(),
      collections.employees().aggregate(countPipeline).toArray(),
    ]);

    return {
      employees,
      total: countResult[0]?.total || 0,
      page,
      limit,
    };
  },

  async getEmployee(id: string) {
    const match: any = {};
    if (isValidObjectId(id)) {
      match.$or = [{ _id: toObjectId(id) }, { empId: id }];
    } else {
      match.empId = id;
    }

    const pipeline: any[] = [
      { $match: match },
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
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'employees',
          localField: 'reportingManager',
          foreignField: '_id',
          as: 'reportingManager',
        },
      },
      { $unwind: { path: '$reportingManager', preserveNullAndEmptyArrays: true } },
    ];

    const result = await collections.employees().aggregate(pipeline).toArray();
    if (!result.length) return null;

    const emp = result[0];
    if (emp.user) {
      emp.user.password = undefined;
      emp.user.passwordResetOtpHash = undefined;
      emp.user.passwordResetTokenHash = undefined;
    }
    return emp;
  },

  async enrollEmployee(data: {
    name: string;
    email: string;
    password: string;
    role?: string;
    department?: string;
    designation?: string;
    empId?: string;
    dateOfJoining?: string;
    reportingManager?: string;
    phone?: string;
    annualCTC?: number;
    basicPercent?: number;
    daAmount?: number;
    specialAllowance?: number;
    enableEPF?: boolean;
    enableESI?: boolean;
    bankAccountName?: string;
    bankAccountNo?: string;
    bankName?: string;
    bankAddress?: string;
    ifscCode?: string;
    epfNo?: string;
    esiNo?: string;
  }) {
    const existingUser = await collections.users().findOne({
      email: data.email.toLowerCase(),
    });
    if (existingUser) {
      return { ok: false as const, status: 400, message: 'Email already registered' };
    }

    const safeRole = data.role || 'employee';
    const hashedPassword = await UsersService.hashPassword(data.password);

    const userResult = await collections.users().insertOne({
      _id: new ObjectId(),
      email: data.email.toLowerCase(),
      password: hashedPassword,
      name: data.name,
      role: safeRole,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    let deptId: ObjectId | null = null;
    if (data.department) {
      deptId = await resolveDepartment(data.department);
    }

    let reportingManagerId: ObjectId | null = null;
    if (data.reportingManager) {
      reportingManagerId = toObjectIdOrNull(data.reportingManager);
    }

    const empIdStr = data.empId || `EMP${Date.now().toString().slice(-6)}`;
    const dateOfJoining = data.dateOfJoining ? new Date(data.dateOfJoining) : new Date();

    const employeeResult = await collections.employees().insertOne({
      _id: new ObjectId(),
      user: userResult.insertedId,
      empId: empIdStr,
      name: data.name,
      department: deptId,
      designation: data.designation || 'Employee',
      dateOfJoining,
      reportingManager: reportingManagerId,
      employmentStatus: 'active',
      onboardingStatus: 'pending_documents',
      isActive: true,
      phone: data.phone,
      annualCTC: data.annualCTC || 0,
      basicPercent: data.basicPercent ?? 50,
      daAmount: data.daAmount || 0,
      specialAllowance: data.specialAllowance || 0,
      enableEPF: data.enableEPF || false,
      enableESI: data.enableESI || false,
      bankAccountName: data.bankAccountName,
      bankAccountNo: data.bankAccountNo,
      bankName: data.bankName,
      bankAddress: data.bankAddress,
      ifscCode: data.ifscCode,
      epfNo: data.epfNo,
      esiNo: data.esiNo,
      canMarkAttendance: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await collections.users().updateOne(
      { _id: userResult.insertedId },
      { $set: { employee: employeeResult.insertedId } },
    );

    return {
      ok: true as const,
      status: 201,
      employee: { _id: employeeResult.insertedId.toString(), empId: empIdStr },
    };
  },

  async updateEmployee(id: string, data: any) {
    const match: any = {};
    if (isValidObjectId(id)) {
      match.$or = [{ _id: toObjectId(id) }, { empId: id }];
    } else {
      match.empId = id;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    const updateFields: any = {};

    if (data.name !== undefined) {
      updateFields.name = data.name;
      if (employee.user) {
        await collections.users().updateOne(
          { _id: employee.user },
          { $set: { name: data.name } },
        );
      }
    }
    if (data.department !== undefined) {
      const deptId = await resolveDepartment(data.department);
      updateFields.department = deptId;
    }
    if (data.designation !== undefined) updateFields.designation = data.designation;
    if (data.empId !== undefined) updateFields.empId = data.empId;
    if (data.dateOfJoining !== undefined) updateFields.dateOfJoining = new Date(data.dateOfJoining);
    if (data.reportingManager !== undefined) {
      updateFields.reportingManager = toObjectIdOrNull(data.reportingManager);
    }
    if (data.phone !== undefined) updateFields.phone = data.phone;
    if (data.emergencyContact !== undefined) updateFields.emergencyContact = data.emergencyContact;
    if (data.address !== undefined) updateFields.address = data.address;
    if (data.dateOfBirth !== undefined) updateFields.dateOfBirth = new Date(data.dateOfBirth);
    if (data.bloodGroup !== undefined) updateFields.bloodGroup = data.bloodGroup;
    if (data.personalEmail !== undefined) updateFields.personalEmail = data.personalEmail;
    if (data.linkedIn !== undefined) updateFields.linkedIn = data.linkedIn;
    if (data.bio !== undefined) updateFields.bio = data.bio;
    if (data.canMarkAttendance !== undefined) updateFields.canMarkAttendance = data.canMarkAttendance;
    if (data.annualCTC !== undefined) updateFields.annualCTC = data.annualCTC;
    if (data.basicPercent !== undefined) updateFields.basicPercent = data.basicPercent;
    if (data.daAmount !== undefined) updateFields.daAmount = data.daAmount;
    if (data.specialAllowance !== undefined) updateFields.specialAllowance = data.specialAllowance;
    if (data.enableEPF !== undefined) updateFields.enableEPF = data.enableEPF;
    if (data.enableESI !== undefined) updateFields.enableESI = data.enableESI;
    if (data.bankAccountName !== undefined) updateFields.bankAccountName = data.bankAccountName;
    if (data.bankAccountNo !== undefined) updateFields.bankAccountNo = data.bankAccountNo;
    if (data.bankName !== undefined) updateFields.bankName = data.bankName;
    if (data.bankAddress !== undefined) updateFields.bankAddress = data.bankAddress;
    if (data.ifscCode !== undefined) updateFields.ifscCode = data.ifscCode;
    if (data.epfNo !== undefined) updateFields.epfNo = data.epfNo;
    if (data.esiNo !== undefined) updateFields.esiNo = data.esiNo;

    if (data.employmentStatus !== undefined) {
      updateFields.employmentStatus = data.employmentStatus;
      if (data.employmentStatus === 'inactive') {
        updateFields.isActive = false;
      } else if (data.employmentStatus === 'former') {
        updateFields.isActive = false;
        updateFields.separation = {
          dateOfLeave: data.dateOfLeave ? new Date(data.dateOfLeave) : new Date(),
          reason: data.separationReason || '',
          separationType: data.separationType || '',
          recordedAt: new Date(),
        };
        if (employee.user) {
          await collections.users().updateOne(
            { _id: employee.user },
            { $set: { isActive: false } },
          );
        }
      } else if (data.employmentStatus === 'active') {
        updateFields.isActive = true;
        if (employee.user) {
          await collections.users().updateOne(
            { _id: employee.user },
            { $set: { isActive: true } },
          );
        }
      }
    }

    updateFields.updatedAt = new Date();
    await collections.employees().updateOne({ _id: employee._id }, { $set: updateFields });

    return { ok: true as const, status: 200 };
  },

  async deleteEmployee(id: string, userId: string) {
    const match: any = {};
    if (isValidObjectId(id)) {
      match.$or = [{ _id: toObjectId(id) }, { empId: id }];
    } else {
      match.empId = id;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    await collections.employees().updateOne(
      { _id: employee._id },
      { $set: { isActive: false, deletedAt: new Date(), deletedBy: toObjectId(userId) } },
    );

    if (employee.user) {
      await collections.users().updateOne(
        { _id: employee.user },
        { $set: { isActive: false } },
      );
    }

    return { ok: true as const, status: 200 };
  },

  async forceLogout(id: string) {
    const match: any = {};
    if (isValidObjectId(id)) {
      match.$or = [{ _id: toObjectId(id) }, { empId: id }];
    } else {
      match.empId = id;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    if (!employee.user) return { ok: false as const, status: 400, message: 'No linked user account' };

    const now = new Date();
    await collections.users().updateOne(
      { _id: employee.user },
      { $set: { forcedLogoutAt: now } },
    );

    // Auto punch-out if currently punched in
    const today = utcMidnight();
    const attendance = await collections.attendances().findOne({
      employee: employee._id,
      date: today,
      'punchOut.time': { $exists: false },
    });

    if (attendance) {
      const closeBreaks = (attendance.breaks || []).map((b: any) => {
        if (b.endTime) return b;
        return { ...b, endTime: now };
      });

      let totalWorking = 0;
      let totalBreak = 0;

      if (attendance.punchIn?.time) {
        const punchInTime = attendance.punchIn.time.getTime();
        let workMs = now.getTime() - punchInTime;
        for (const b of closeBreaks) {
          if (b.startTime && b.endTime) {
            totalBreak += (b.endTime.getTime() - b.startTime.getTime()) / 60000;
          }
        }
        totalWorking = Math.max(0, (workMs - totalBreak * 60000) / 60000);
      }

      await collections.attendances().updateOne(
        { _id: attendance._id },
        {
          $set: {
            punchOut: {
              time: now,
              location: { lat: 0, lng: 0 },
              selfieUrl: 'force-logout',
              withinGeofence: true,
              distanceFromOffice: 0,
            },
            breaks: closeBreaks,
            totalWorkingMinutes: Math.round(totalWorking),
            totalBreakMinutes: Math.round(totalBreak),
            netWorkingMinutes: Math.round(totalWorking),
            isEarlyLeave: true,
            source: 'auto',
            updatedAt: now,
          },
        },
      );
    }

    return { ok: true as const, status: 200 };
  },

  async getEnrollmentStats() {
    const totalEmployees = await collections.employees().countDocuments({ isActive: { $ne: false } });
    const byStatus = await collections.employees()
      .aggregate([
        { $match: { isActive: { $ne: false } } },
        { $group: { _id: '$onboardingStatus', count: { $sum: 1 } } },
      ])
      .toArray();

    const byDepartment = await collections.employees()
      .aggregate([
        { $match: { isActive: { $ne: false } } },
        {
          $lookup: {
            from: 'departments',
            localField: 'department',
            foreignField: '_id',
            as: 'dept',
          },
        },
        { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$dept.name', count: { $sum: 1 } } },
      ])
      .toArray();

    const recentEnrollments = await collections.employees()
      .find({ isActive: { $ne: false } })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    return {
      totalEmployees,
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id || 'unknown', s.count])),
      byDepartment: byDepartment.map((d) => ({ department: d._id || 'Unassigned', count: d.count })),
      recentEnrollments,
    };
  },

  async getPendingApprovals() {
    const employees = await collections.employees()
      .aggregate([
        { $match: { onboardingStatus: { $in: ['pending_documents', 'pending_approval'] } } },
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
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    const pendingDocuments = employees.filter((e) => e.onboardingStatus === 'pending_documents');
    const pendingApproval = employees.filter((e) => e.onboardingStatus === 'pending_approval');

    return {
      total: employees.length,
      pendingDocuments: {
        count: pendingDocuments.length,
        employees: pendingDocuments,
      },
      pendingApproval: {
        count: pendingApproval.length,
        employees: pendingApproval,
      },
    };
  },

  async approveOnboarding(empId: string, userId: string) {
    const match: any = {};
    if (isValidObjectId(empId)) {
      match.$or = [{ _id: toObjectId(empId) }, { empId }];
    } else {
      match.empId = empId;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    await collections.employees().updateOne(
      { _id: employee._id },
      {
        $set: {
          onboardingStatus: 'approved',
          onboardingApprovedBy: toObjectId(userId),
          onboardingApprovedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    if (employee.user) {
      await collections.users().updateOne(
        { _id: employee.user },
        { $set: { isActive: true } },
      );
    }

    return { ok: true as const, status: 200 };
  },

  async rejectOnboarding(empId: string, reason: string) {
    const match: any = {};
    if (isValidObjectId(empId)) {
      match.$or = [{ _id: toObjectId(empId) }, { empId }];
    } else {
      match.empId = empId;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    await collections.employees().updateOne(
      { _id: employee._id },
      {
        $set: {
          onboardingStatus: 'rejected',
          onboardingRejectionReason: reason,
          updatedAt: new Date(),
        },
      },
    );

    return { ok: true as const, status: 200 };
  },

  async uploadDocument(
    empId: string,
    file: { name: string; size: number; type: string; key: string },
    docType: string,
  ) {
    const match: any = {};
    if (isValidObjectId(empId)) {
      match.$or = [{ _id: toObjectId(empId) }, { empId }];
    } else {
      match.empId = empId;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    if (!ALL_DOC_TYPES.includes(docType as DocumentType)) {
      return { ok: false as const, status: 400, message: `Invalid document type: ${docType}` };
    }

    const isMandatory = MANDATORY_DOC_TYPES.includes(docType as DocumentType);

    await collections.documents().updateOne(
      { employee: employee._id, type: docType as DocumentType },
      {
        $set: {
          employee: employee._id,
          type: docType as DocumentType,
          fileUrl: file.key,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          isRequired: isMandatory,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );

    // Auto-advance onboarding when all mandatory docs are present
    if (employee.onboardingStatus === 'pending_documents') {
      const docs = await collections.documents()
        .find({ employee: employee._id })
        .toArray();
      const uploadedTypes = docs.map((d) => d.type);
      const allMandatoryPresent = MANDATORY_DOC_TYPES.every((t) => uploadedTypes.includes(t));

      if (allMandatoryPresent) {
        await collections.employees().updateOne(
          { _id: employee._id },
          { $set: { onboardingStatus: 'pending_approval', updatedAt: new Date() } },
        );
      }
    }

    return { ok: true as const, status: 200 };
  },

  async getEmployeeDocuments(empId: string) {
    const match: any = {};
    if (isValidObjectId(empId)) {
      match.$or = [{ _id: toObjectId(empId) }, { empId }];
    } else {
      match.empId = empId;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    const docs = await collections.documents()
      .find({ employee: employee._id })
      .toArray();

    const uploadedTypes = docs.map((d) => d.type);
    const checklist = ALL_DOC_TYPES.map((type) => ({
      type,
      label: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      isRequired: MANDATORY_DOC_TYPES.includes(type),
      uploaded: uploadedTypes.includes(type),
      document: docs.find((d) => d.type === type) || null,
    }));

    return { ok: true as const, documents: docs, checklist };
  },

  async getEmployeeDocumentDetails(empId: string) {
    const match: any = {};
    if (isValidObjectId(empId)) {
      match.$or = [{ _id: toObjectId(empId) }, { empId }];
    } else {
      match.empId = empId;
    }

    const employee = await collections.employees().findOne(match);
    if (!employee) return { ok: false as const, status: 404, message: 'Employee not found' };

    const docs = await collections.documents()
      .find({ employee: employee._id })
      .toArray();

    const details = ALL_DOC_TYPES.map((type) => {
      const doc = docs.find((d) => d.type === type);
      return {
        type,
        label: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        isRequired: MANDATORY_DOC_TYPES.includes(type),
        uploaded: !!doc,
        icon: docIcon(type),
        document: doc || null,
      };
    });

    return { ok: true as const, employee, documents: details };
  },

  async deleteDocument(docId: string) {
    if (!isValidObjectId(docId)) {
      return { ok: false as const, status: 400, message: 'Invalid document ID' };
    }

    const doc = await collections.documents().findOne({ _id: toObjectId(docId) });
    if (!doc) return { ok: false as const, status: 404, message: 'Document not found' };

    await collections.documents().deleteOne({ _id: doc._id });

    // Revert onboarding status if mandatory doc removed
    if (MANDATORY_DOC_TYPES.includes(doc.type)) {
      const remainingDocs = await collections.documents()
        .find({ employee: doc.employee })
        .toArray();
      const remainingTypes = remainingDocs.map((d) => d.type);
      const allMandatoryPresent = MANDATORY_DOC_TYPES.every((t) => remainingTypes.includes(t));

      if (!allMandatoryPresent) {
        await collections.employees().updateOne(
          { _id: doc.employee },
          { $set: { onboardingStatus: 'pending_documents', updatedAt: new Date() } },
        );
      }
    }

    return { ok: true as const, status: 200 };
  },
};

async function resolveDepartment(department: string): Promise<ObjectId | null> {
  const deptCode = department.toUpperCase().slice(0, 10);
  const query: any = isValidObjectId(department)
    ? { $or: [{ _id: toObjectId(department) }, { code: deptCode }, { name: department }] }
    : { $or: [{ code: deptCode }, { name: department }] };

  const existing = await collections.departments().findOne(query);
  if (existing) return existing._id;

  const created = await collections.departments().insertOne({
    _id: new ObjectId(),
    name: department,
    code: deptCode,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
  return created.insertedId;
}

function docIcon(type: string): string {
  const icons: Record<string, string> = {
    aadhar: '🆔',
    pan: '💳',
    bank_details: '🏦',
    qualification_cert: '🎓',
    nda: '🔒',
    offer_letter: '📄',
    joining_letter: '✍️',
    relieving_letter: '📋',
    police_verification: '🛡️',
  };
  return icons[type] || '📎';
}
