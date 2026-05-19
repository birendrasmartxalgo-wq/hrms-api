import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import type { AnnouncementPriority } from '../../db/types/Announcement';
import type { UserRole } from '../../db/types/User';
import type { AuthUser } from '../../plugins/auth';
import { ApiError, forbidden, unauthorized } from '../../errors';
import { notifyAll } from '../../services/notify';

type Actor = { userId: ObjectId; employeeId: ObjectId; role: UserRole };

function objectId(value: string | undefined, field = 'id') {
  if (!value || !ObjectId.isValid(value)) {
    throw new ApiError(422, 'INVALID_OBJECT_ID', `${field} is not a valid ObjectId`);
  }

  return new ObjectId(value);
}

async function requireActor(user: AuthUser | null | undefined): Promise<Actor> {
  if (!user) throw unauthorized('No token provided');
  const record = await collections.users().findOne(
    { _id: objectId(user.userId, 'userId') },
    { projection: { employee: 1, role: 1 } },
  );
  if (!record?.employee) throw new ApiError(400, 'NO_EMPLOYEE_PROFILE', 'No employee profile linked to this account');
  return { userId: record._id, employeeId: record.employee, role: record.role };
}

function requireAdminHr(actor: Actor) {
  if (actor.role !== 'admin' && actor.role !== 'hr') throw forbidden();
}

async function hydrateAnnouncements(limit: number, match: Record<string, unknown> = {}) {
  return collections
    .announcements()
    .aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'employees',
          localField: 'postedBy',
          foreignField: '_id',
          as: 'postedBy',
        },
      },
      { $unwind: { path: '$postedBy', preserveNullAndEmptyArrays: true } },
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
          title: 1,
          body: 1,
          priority: 1,
          targetAll: 1,
          createdAt: 1,
          updatedAt: 1,
          postedBy: {
            _id: '$postedBy._id',
            name: '$postedBy.name',
            empId: '$postedBy.empId',
            designation: '$postedBy.designation',
          },
          department: {
            _id: '$department._id',
            name: '$department.name',
            code: '$department.code',
          },
        },
      },
    ])
    .toArray();
}

export const AnnouncementService = {
  async list(limit = 20) {
    return hydrateAnnouncements(Math.min(Math.max(limit, 1), 100));
  },

  async create(
    user: AuthUser | null | undefined,
    input: { title: string; body: string; priority?: AnnouncementPriority; department?: string },
  ) {
    if (!input.title?.trim() || !input.body?.trim()) {
      throw new ApiError(400, 'ANNOUNCEMENT_REQUIRED', 'Title and body are required');
    }

    const actor = await requireActor(user);
    requireAdminHr(actor);

    const now = new Date();
    const department = input.department ? objectId(input.department, 'department') : null;
    const doc = {
      _id: new ObjectId(),
      title: input.title.trim(),
      body: input.body.trim(),
      priority: input.priority ?? 'normal',
      postedBy: actor.employeeId,
      department,
      targetAll: !department,
      createdAt: now,
      updatedAt: now,
    };

    await collections.announcements().insertOne(doc);

    const priorityLabel = doc.priority === 'urgent' ? 'Urgent' : doc.priority === 'important' ? 'Important' : 'Announcement';
    await notifyAll(
      {
        title: `${priorityLabel}: ${doc.title}`,
        body: doc.body,
        type: 'announcement',
        link: '/announcements',
      },
      actor.employeeId,
    );

    const [created] = await hydrateAnnouncements(1, { _id: doc._id });
    return created;
  },

  async delete(user: AuthUser | null | undefined, id: string) {
    const actor = await requireActor(user);
    requireAdminHr(actor);

    const deleted = await collections.announcements().findOneAndDelete({ _id: objectId(id) });
    if (!deleted) throw new ApiError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found');
  },
};
