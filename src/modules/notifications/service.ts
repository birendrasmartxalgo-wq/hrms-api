import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import type { AuthUser } from '../../plugins/auth';
import { ApiError, unauthorized } from '../../errors';

function objectId(value: string, field = 'id') {
  if (!ObjectId.isValid(value)) {
    throw new ApiError(422, 'INVALID_OBJECT_ID', `${field} is not a valid ObjectId`);
  }

  return new ObjectId(value);
}

async function requireEmployee(user: AuthUser | null | undefined) {
  if (!user) throw unauthorized('No token provided');
  const record = await collections.users().findOne(
    { _id: objectId(user.userId, 'userId') },
    { projection: { employee: 1 } },
  );
  if (!record?.employee) throw new ApiError(400, 'NO_EMPLOYEE_PROFILE', 'No employee profile linked to this account');
  return record.employee;
}

export const NotificationService = {
  async list(user: AuthUser | null | undefined) {
    const employee = await requireEmployee(user);
    const docs = await collections.notifications().find({ employee }).sort({ createdAt: -1 }).limit(50).toArray();
    return docs.map((d) => ({ ...d, message: d.body ?? d.title }));
  },

  async readAll(user: AuthUser | null | undefined) {
    const employee = await requireEmployee(user);
    await collections.notifications().updateMany(
      { employee, read: false },
      { $set: { read: true, updatedAt: new Date() } },
    );
  },

  async readOne(user: AuthUser | null | undefined, id: string) {
    const employee = await requireEmployee(user);
    await collections.notifications().findOneAndUpdate(
      { _id: objectId(id), employee },
      { $set: { read: true, updatedAt: new Date() } },
    );
  },

  async dismiss(user: AuthUser | null | undefined, id: string) {
    const employee = await requireEmployee(user);
    await collections.notifications().deleteOne({ _id: objectId(id), employee });
  },
};
