import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import { UsersService } from '../users/service';
import { toObjectId, isValidObjectId } from '../../utils/ids';
import type { DocumentType } from '../../db/types/Document';

const MANDATORY_DOC_TYPES: DocumentType[] = [
  'aadhar', 'pan', 'bank_details', 'qualification_cert',
  'nda', 'offer_letter', 'joining_letter',
];

const ALL_DOC_TYPES: DocumentType[] = [
  ...MANDATORY_DOC_TYPES, 'relieving_letter', 'police_verification',
];

export const ProfileService = {
  async getMyProfile(userId: string) {
    const pipeline: any[] = [
      { $match: { _id: toObjectId(userId) } },
      { $project: { password: 0, passwordResetOtpHash: 0, passwordResetTokenHash: 0 } },
      {
        $lookup: {
          from: 'employees',
          localField: 'employee',
          foreignField: '_id',
          as: 'employeeObj',
        },
      },
      { $unwind: { path: '$employeeObj', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'departments',
          localField: 'employeeObj.department',
          foreignField: '_id',
          as: 'departmentObj',
        },
      },
      { $unwind: { path: '$departmentObj', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeObj.reportingManager',
          foreignField: '_id',
          as: 'reportingManagerObj',
        },
      },
      { $unwind: { path: '$reportingManagerObj', preserveNullAndEmptyArrays: true } },
    ];

    const users = await collections.users().aggregate(pipeline).toArray();
    if (!users.length) return null;

    const user = users[0];

    if (user.employeeObj) {
      if (user.departmentObj) {
        user.employeeObj.department = user.departmentObj;
      }
      if (user.reportingManagerObj) {
        user.employeeObj.reportingManager = user.reportingManagerObj;
      }
      user.employee = user.employeeObj;
      delete user.employeeObj;
      delete user.departmentObj;
      delete user.reportingManagerObj;
    }

    return user;
  },

  async updateMyProfile(userId: string, data: any) {
    const user = await collections.users().findOne({ _id: toObjectId(userId) });
    if (!user || !user.employee) {
      return { ok: false as const, status: 404, message: 'Profile not found' };
    }

    const updateFields: any = { updatedAt: new Date() };

    if (data.name !== undefined) {
      updateFields.name = data.name;
      await collections.users().updateOne(
        { _id: user._id },
        { $set: { name: data.name } },
      );
    }
    if (data.phone !== undefined) updateFields.phone = data.phone;
    if (data.emergencyContact !== undefined) updateFields.emergencyContact = data.emergencyContact;
    if (data.address !== undefined) updateFields.address = data.address;
    if (data.dateOfBirth !== undefined) updateFields.dateOfBirth = new Date(data.dateOfBirth);
    if (data.bloodGroup !== undefined) updateFields.bloodGroup = data.bloodGroup;
    if (data.personalEmail !== undefined) updateFields.personalEmail = data.personalEmail;
    if (data.linkedIn !== undefined) updateFields.linkedIn = data.linkedIn;
    if (data.bio !== undefined) updateFields.bio = data.bio;

    await collections.employees().updateOne(
      { _id: user.employee },
      { $set: updateFields },
    );

    return { ok: true as const, status: 200 };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await collections.users().findOne({ _id: toObjectId(userId) });
    if (!user) return { ok: false as const, status: 404, message: 'User not found' };

    const isMatch = await UsersService.verifyPassword(user, currentPassword);
    if (!isMatch) {
      return { ok: false as const, status: 400, message: 'Current password is incorrect' };
    }

    if (currentPassword === newPassword) {
      return { ok: false as const, status: 400, message: 'New password must be different from current password' };
    }

    if (newPassword.length < 8) {
      return { ok: false as const, status: 400, message: 'Password must be at least 8 characters' };
    }

    await UsersService.updateOne(
      { _id: user._id },
      { $set: { password: newPassword } },
    );

    return { ok: true as const, status: 200 };
  },

  async uploadAvatar(userId: string, file: { name: string; size: number; type: string; key: string }) {
    const user = await collections.users().findOne({ _id: toObjectId(userId) });
    if (!user || !user.employee) {
      return { ok: false as const, status: 404, message: 'Profile not found' };
    }

    await collections.employees().updateOne(
      { _id: user.employee },
      { $set: { avatar: file.key, updatedAt: new Date() } },
    );

    return { ok: true as const, status: 200, key: file.key };
  },

  async uploadSelfDocument(
    userId: string,
    file: { name: string; size: number; type: string; key: string },
    docType: string,
  ) {
    const user = await collections.users().findOne({ _id: toObjectId(userId) });
    if (!user || !user.employee) {
      return { ok: false as const, status: 404, message: 'Profile not found' };
    }

    if (!ALL_DOC_TYPES.includes(docType as DocumentType)) {
      return { ok: false as const, status: 400, message: `Invalid document type: ${docType}` };
    }

    const isMandatory = MANDATORY_DOC_TYPES.includes(docType as DocumentType);

    await collections.documents().updateOne(
      { employee: user.employee, type: docType as DocumentType },
      {
        $set: {
          employee: user.employee,
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

    // Auto-advance onboarding
    const employee = await collections.employees().findOne({ _id: user.employee });
    if (employee?.onboardingStatus === 'pending_documents') {
      const docs = await collections.documents()
        .find({ employee: user.employee })
        .toArray();
      const uploadedTypes = docs.map((d) => d.type);
      const allMandatoryPresent = MANDATORY_DOC_TYPES.every((t) => uploadedTypes.includes(t));

      if (allMandatoryPresent) {
        await collections.employees().updateOne(
          { _id: user.employee },
          { $set: { onboardingStatus: 'pending_approval', updatedAt: new Date() } },
        );
      }
    }

    return { ok: true as const, status: 200, key: file.key };
  },

  async getMyDocuments(userId: string) {
    const user = await collections.users().findOne({ _id: toObjectId(userId) });
    if (!user || !user.employee) {
      return { ok: false as const, status: 404, message: 'Profile not found' };
    }

    const docs = await collections.documents()
      .find({ employee: user.employee })
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

  async adminChangePassword(adminUserId: string, targetUserId: string, newPassword: string) {
    const admin = await collections.users().findOne({ _id: toObjectId(adminUserId) });
    if (!admin || admin.role !== 'admin') {
      return { ok: false as const, status: 403, message: 'Forbidden' };
    }

    const targetUser = await collections.users().findOne({ _id: toObjectId(targetUserId) });
    if (!targetUser) {
      return { ok: false as const, status: 404, message: 'User not found' };
    }

    if (newPassword.length < 8) {
      return { ok: false as const, status: 400, message: 'Password must be at least 8 characters' };
    }

    await UsersService.updateOne(
      { _id: targetUser._id },
      { $set: { password: newPassword } },
    );

    return { ok: true as const, status: 200 };
  },

  async getEmployeeProfile(empId: string) {
    const match: any = {};
    if (isValidObjectId(empId)) {
      match.$or = [{ _id: toObjectId(empId) }, { empId }];
    } else {
      match.empId = empId;
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
        $project: {
          name: 1,
          empId: 1,
          department: 1,
          designation: 1,
          dateOfJoining: 1,
          avatar: 1,
          bio: 1,
        },
      },
    ];

    const employees = await collections.employees().aggregate(pipeline).toArray();
    if (!employees.length) return null;

    return employees[0];
  },
};
