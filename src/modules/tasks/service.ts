import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import { notifyEmployee } from '../../services/notify';
import { taskAssignedEmail, taskStatusEmail } from '../../services/emailService';
import type { TaskDocument, TaskSubtask, TaskActivityLog } from '../../db/types/Task';

export const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  in_review: 'In Review', done: 'Done', cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'None',
};

export const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'];

export const TaskService = {
  calcSubtaskProgress(subtasks: TaskSubtask[] | undefined) {
    if (!subtasks || subtasks.length === 0) return 0;
    const done = subtasks.filter(s => s.completed).length;
    return Math.round((done / subtasks.length) * 100);
  },

  buildActivity(action: string, performedBy: ObjectId, description: string, meta: any = {}): TaskActivityLog {
    return { action, performedBy, description, meta, at: new Date() };
  },

  toObjectId(id: any) {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && ObjectId.isValid(id)) return new ObjectId(id);
    return null;
  },

  async populateTask(taskId: ObjectId) {
    const rows = await collections.tasks().aggregate([
      { $match: { _id: taskId } },
      { $lookup: { from: 'employees', localField: 'assignee', foreignField: '_id', as: '_assignee' } },
      { $lookup: { from: 'employees', localField: 'createdBy', foreignField: '_id', as: '_createdBy' } },
      { $lookup: { from: 'employees', localField: 'watchers', foreignField: '_id', as: '_watchers' } },
      { $lookup: { from: 'employees', localField: 'comments.author', foreignField: '_id', as: '_commentAuthors' } },
      { $lookup: { from: 'employees', localField: 'subtasks.assignee', foreignField: '_id', as: '_subAssignees' } },
      { $lookup: { from: 'tasks', localField: 'parentTask', foreignField: '_id', as: '_parentTask' } },
      { $lookup: { from: 'tasks', localField: 'dependencies', foreignField: '_id', as: '_dependencies' } },
      { $lookup: { from: 'employees', localField: 'activityLog.performedBy', foreignField: '_id', as: '_activityActors' } },
    ]).toArray();
    if (rows.length === 0) return null;
    const t: any = rows[0];

    const pickEmp = (id: ObjectId | undefined, pool: any[]) => {
      if (!id) return null;
      const e = pool.find(p => p._id.equals(id));
      return e ? { _id: e._id, name: e.name, empId: e.empId, avatar: e.avatar, department: e.department, designation: e.designation } : null;
    };

    t.assignee   = pickEmp(t.assignee, t._assignee);
    t.createdBy  = pickEmp(t.createdBy, t._createdBy);
    t.watchers   = (t.watchers || []).map((id: ObjectId) => pickEmp(id, t._watchers)).filter(Boolean);
    t.comments   = (t.comments || []).map((c: any) => ({ ...c, author: pickEmp(c.author, t._commentAuthors) }));
    t.subtasks   = (t.subtasks || []).map((s: any) => ({ ...s, assignee: s.assignee ? pickEmp(s.assignee, t._subAssignees) : null }));
    t.activityLog = (t.activityLog || []).map((a: any) => ({ ...a, performedBy: pickEmp(a.performedBy, t._activityActors) }));
    t.parentTask = t._parentTask?.[0] ? { _id: t._parentTask[0]._id, title: t._parentTask[0].title, status: t._parentTask[0].status } : null;
    t.dependencies = (t._dependencies || []).map((d: any) => ({ _id: d._id, title: d.title, status: d.status }));

    delete t._assignee; delete t._createdBy; delete t._watchers;
    delete t._commentAuthors; delete t._subAssignees; delete t._parentTask;
    delete t._dependencies; delete t._activityActors;
    return t;
  },

  async populateLight(taskId: ObjectId) {
    const rows = await collections.tasks().aggregate([
      { $match: { _id: taskId } },
      { $lookup: { from: 'employees', localField: 'assignee', foreignField: '_id', as: '_assignee' } },
      { $lookup: { from: 'employees', localField: 'createdBy', foreignField: '_id', as: '_createdBy' } },
    ]).toArray();
    if (rows.length === 0) return null;
    const t: any = rows[0];
    const pick = (id: ObjectId | undefined, pool: any[]) => {
      if (!id) return null;
      const e = pool.find(p => p._id.equals(id));
      return e ? { _id: e._id, name: e.name, empId: e.empId, avatar: e.avatar } : null;
    };
    t.assignee = pick(t.assignee, t._assignee);
    t.createdBy = pick(t.createdBy, t._createdBy);
    delete t._assignee; delete t._createdBy;
    return t;
  },

  async sendAssignmentNotifications(task: TaskDocument, assigneeEmpId: ObjectId, creatorEmpId: ObjectId) {
    try {
      const [assigneeUser, creatorUser] = await Promise.all([
        collections.users().findOne({ employee: assigneeEmpId }, { projection: { email: 1, name: 1 } }),
        collections.users().findOne({ employee: creatorEmpId }, { projection: { email: 1, name: 1 } }),
      ]);

      await notifyEmployee(assigneeEmpId, {
        title: '📋 New Task Assigned',
        body: `"${task.title}" assigned by ${creatorUser?.name || 'Someone'}`,
        type: 'task',
        link: '/tasks',
      });

      if (assigneeUser?.email) {
        taskAssignedEmail(task, assigneeUser.name, assigneeUser.email, creatorUser?.name || 'Someone').catch(() => {});
      }

      const admins = await collections.users().find({ role: 'admin', isActive: true }, { projection: { email: 1, name: 1 } }).toArray();
      for (const admin of admins) {
        if (admin.email && admin.email !== assigneeUser?.email) {
          taskAssignedEmail(task, admin.name, admin.email, creatorUser?.name || 'Someone').catch(() => {});
        }
      }
    } catch (e) {
      console.error('[tasks] notify assignment failed:', (e as Error).message);
    }
  },

  async sendStatusChangeNotifications(task: TaskDocument, oldStatus: string, newStatus: string, updaterEmpId: ObjectId) {
    try {
      const updaterUser = await collections.users().findOne({ employee: updaterEmpId }, { projection: { name: 1 } });
      const updaterName = updaterUser?.name || 'Someone';
      const statusLabel = newStatus.replace(/_/g, ' ');

      if (task.assignee) {
        await notifyEmployee(task.assignee, {
          title: `✅ Task ${statusLabel}`,
          body: `"${task.title}" marked as ${statusLabel} by ${updaterName}`,
          type: 'task',
          link: '/tasks',
        });
        const assigneeUser = await collections.users().findOne({ employee: task.assignee }, { projection: { email: 1, name: 1 } });
        if (assigneeUser?.email) {
          taskStatusEmail(task, assigneeUser.name, assigneeUser.email, updaterName, oldStatus, newStatus).catch(() => {});
        }
      }

      const adminHrUsers = await collections.users().find({ role: { $in: ['admin', 'hr'] }, isActive: true }, { projection: { email: 1, name: 1, employee: 1 } }).toArray();
      for (const u of adminHrUsers) {
        if (u.employee && task.assignee && !u.employee.equals(task.assignee)) {
          await notifyEmployee(u.employee, {
            title: `📋 Task Updated: ${statusLabel}`,
            body: `"${task.title}" → ${statusLabel} by ${updaterName}`,
            type: 'task',
            link: '/tasks',
          });
        }
        if (u.email) {
          taskStatusEmail(task, u.name, u.email, updaterName, oldStatus, newStatus).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[tasks] notify status change failed:', (e as Error).message);
    }
  },
};
