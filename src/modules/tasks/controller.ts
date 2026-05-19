import { Elysia } from 'elysia';
import { ObjectId, type Filter } from 'mongodb';
import { authPlugin } from '../../plugins/auth';
import { collections } from '../../db/collections';
import { putObject, buildUploadKey } from '../../services/s3';
import { TaskSchemas } from './schema';
import { TaskService, STATUS_LABEL, PRIORITY_LABEL, VALID_STATUSES } from './service';
import type { TaskDocument, TaskActivityLog } from '../../db/types/Task';

function parseDate(v: any): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function toOid(v: any) { return TaskService.toObjectId(v); }

export const taskController = new Elysia({ prefix: '/tasks' })
  .use(authPlugin)
  .guard({ authorize: true as const }, app => app

  // ─── STATS ────────────────────────────────────────────────────────────────
  .get('/stats', async ({ user, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empOid = user.employeeId ? toOid(user.employeeId) : null;
    const isAdmin = user.role === 'admin' || user.role === 'hr';

    const baseFilter: Filter<TaskDocument> = isAdmin || !empOid ? {} : {
      $or: [
        { assignee: empOid },
        { createdBy: empOid },
        { watchers: empOid },
      ] as any,
    };

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    const day = startOfWeek.getDay();
    const diff = day === 0 ? 6 : day - 1;
    startOfWeek.setDate(startOfWeek.getDate() - diff);

    const c = collections.tasks();
    const [total, byStatusAgg, byPriorityAgg, overdue, completedThisWeek, avgCompletionAgg] = await Promise.all([
      c.countDocuments(baseFilter),
      c.aggregate([{ $match: baseFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
      c.aggregate([{ $match: { ...baseFilter, status: { $nin: ['done', 'cancelled'] } } }, { $group: { _id: '$priority', count: { $sum: 1 } } }]).toArray(),
      c.countDocuments({ ...baseFilter, dueDate: { $lt: startOfDay }, status: { $nin: ['done', 'cancelled'] } } as any),
      c.countDocuments({ ...baseFilter, status: 'done', completedAt: { $gte: startOfWeek } } as any),
      c.aggregate([
        { $match: { ...baseFilter, status: 'done', completedAt: { $ne: null } } },
        { $project: { completionTime: { $subtract: ['$completedAt', '$createdAt'] } } },
        { $group: { _id: null, avg: { $avg: '$completionTime' } } },
      ]).toArray(),
    ]);

    const byStatus: Record<string, number> = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, cancelled: 0 };
    for (const s of byStatusAgg) if (s._id in byStatus) byStatus[s._id] = s.count;
    const byPriority: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
    for (const p of byPriorityAgg) if (p._id in byPriority) byPriority[p._id] = p.count;

    const avgMs = avgCompletionAgg[0]?.avg || 0;
    const avgCompletionTime = avgMs > 0 ? `${Math.round(avgMs / (1000 * 60 * 60 * 24))} days` : 'N/A';
    return { total, byStatus, byPriority, overdue, completedThisWeek, avgCompletionTime };
  })

  // ─── KANBAN ───────────────────────────────────────────────────────────────
  .get('/kanban', async ({ query }) => {
    const filter: Filter<TaskDocument> = { status: { $ne: 'cancelled' } as any };
    if (query.project) filter.project = query.project;
    if (query.assignee) {
      const oid = toOid(query.assignee);
      if (oid) (filter as any).assignee = oid;
    }

    const tasks = await collections.tasks().aggregate([
      { $match: filter },
      { $lookup: { from: 'employees', localField: 'assignee', foreignField: '_id', as: '_assignee' } },
      { $sort: { priority: 1, dueDate: 1 } },
    ]).toArray();

    const kanban: Record<string, any[]> = { backlog: [], todo: [], in_progress: [], in_review: [], done: [] };
    for (const t of tasks) {
      const enriched = {
        _id: t._id, title: t.title, priority: t.priority, dueDate: t.dueDate, status: t.status,
        progress: t.progress, tags: t.tags,
        assignee: t._assignee?.[0] ? { _id: t._assignee[0]._id, name: t._assignee[0].name, empId: t._assignee[0].empId, avatar: t._assignee[0].avatar } : null,
        subtaskProgress: t.subtasks?.length ? `${t.subtasks.filter((s: any) => s.completed).length}/${t.subtasks.length}` : null,
        commentCount: t.comments?.length || 0,
      };
      if (t.status && kanban[t.status]) kanban[t.status].push(enriched);
    }
    return kanban;
  }, TaskSchemas.Kanban)

  // ─── BULK STATUS ──────────────────────────────────────────────────────────
  .put('/bulk-status', async ({ body, set }) => {
    const oids = body.taskIds.map(toOid).filter((x): x is ObjectId => !!x);
    if (oids.length === 0) { set.status = 400; return { message: 'No valid taskIds' }; }
    const updateFields: any = { status: body.status };
    if (body.status === 'done') updateFields.completedAt = new Date();

    const result = await collections.tasks().updateMany({ _id: { $in: oids } }, { $set: updateFields });
    if (body.status !== 'done') {
      await collections.tasks().updateMany({ _id: { $in: oids } }, { $unset: { completedAt: '' } });
    }
    return { message: `${result.modifiedCount} tasks updated to ${body.status}` };
  }, TaskSchemas.BulkStatus)

  // ─── CREATE ───────────────────────────────────────────────────────────────
  .post('/', async ({ user, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const createdBy = user.employeeId ? toOid(user.employeeId) : null;
    if (!createdBy) { set.status = 400; return { message: 'User has no linked employee profile' }; }

    const assignee = body.assignee ? toOid(body.assignee) : undefined;
    const parentTask = body.parentTask ? toOid(body.parentTask) : undefined;

    const watchers: ObjectId[] = [createdBy];
    if (assignee && !assignee.equals(createdBy)) watchers.push(assignee);

    const now = new Date();
    const doc: TaskDocument = {
      _id: new ObjectId(),
      title: body.title.trim(),
      description: body.description || '',
      createdBy,
      assignee: assignee || undefined,
      watchers,
      project: body.project,
      tags: body.tags || [],
      status: 'todo',
      priority: body.priority || 'medium',
      dueDate: parseDate(body.dueDate),
      startDate: parseDate(body.startDate),
      estimatedHours: body.estimatedHours,
      loggedHours: 0,
      subtasks: [],
      comments: [],
      timeEntries: [],
      attachments: [],
      parentTask: parentTask || undefined,
      dependencies: [],
      isRecurring: false,
      recurringPattern: 'none',
      progress: 0,
      activityLog: [TaskService.buildActivity('created', createdBy, 'Task created')],
      createdAt: now,
      updatedAt: now,
    };

    await collections.tasks().insertOne(doc);

    if (assignee) {
      TaskService.sendAssignmentNotifications(doc, assignee, createdBy).catch(() => {});
    }

    set.status = 201;
    return await TaskService.populateLight(doc._id);
  }, TaskSchemas.Create)

  // ─── LIST ─────────────────────────────────────────────────────────────────
  .get('/', async ({ query }) => {
    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.assignee) { const a = toOid(query.assignee); if (a) filter.assignee = a; }
    if (query.project) filter.project = query.project;
    if (query.tag) filter.tags = query.tag;
    if (query.search) filter.$text = { $search: query.search };

    if (query.dueDate) {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);
      switch (query.dueDate) {
        case 'overdue': filter.dueDate = { $lt: startOfDay }; filter.status = { $nin: ['done', 'cancelled'] }; break;
        case 'today': filter.dueDate = { $gte: startOfDay, $lt: endOfDay }; break;
        case 'week': { const e = new Date(startOfDay); e.setDate(e.getDate() + 7); filter.dueDate = { $gte: startOfDay, $lt: e }; break; }
        case 'month': { const e = new Date(startOfDay); e.setMonth(e.getMonth() + 1); filter.dueDate = { $gte: startOfDay, $lt: e }; break; }
      }
    }

    const sortMap: Record<string, any> = {
      dueDate: { dueDate: 1 }, '-dueDate': { dueDate: -1 },
      priority: { priority: 1 },
      createdAt: { createdAt: 1 }, '-createdAt': { createdAt: -1 },
    };
    const sortObj = (query.sort && sortMap[query.sort]) || { createdAt: -1 };

    if (query.view === 'kanban') {
      const tasks = await collections.tasks().aggregate([
        { $match: filter },
        { $lookup: { from: 'employees', localField: 'assignee', foreignField: '_id', as: '_assignee' } },
        { $lookup: { from: 'employees', localField: 'createdBy', foreignField: '_id', as: '_createdBy' } },
        { $sort: sortObj },
      ]).toArray();
      const enriched: any[] = tasks.map(t => ({
        ...t,
        assignee: t._assignee?.[0] ? { _id: t._assignee[0]._id, name: t._assignee[0].name, empId: t._assignee[0].empId, avatar: t._assignee[0].avatar } : null,
        createdBy: t._createdBy?.[0] ? { _id: t._createdBy[0]._id, name: t._createdBy[0].name } : null,
        _assignee: undefined, _createdBy: undefined,
      }));
      const kanban: Record<string, any[]> = { backlog: [], todo: [], in_progress: [], in_review: [], done: [], cancelled: [] };
      for (const t of enriched) if (t.status && kanban[t.status]) kanban[t.status].push(t);
      return { kanban, total: enriched.length };
    }

    const page = Math.max(1, parseInt(query.page || '1'));
    const limit = Math.max(1, parseInt(query.limit || '50'));
    const skip = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      collections.tasks().aggregate([
        { $match: filter },
        { $lookup: { from: 'employees', localField: 'assignee', foreignField: '_id', as: '_assignee' } },
        { $lookup: { from: 'employees', localField: 'createdBy', foreignField: '_id', as: '_createdBy' } },
        { $sort: sortObj },
        { $skip: skip },
        { $limit: limit },
      ]).toArray(),
      collections.tasks().countDocuments(filter),
    ]);

    const data = tasks.map(t => ({
      ...t,
      assignee: t._assignee?.[0] ? { _id: t._assignee[0]._id, name: t._assignee[0].name, empId: t._assignee[0].empId, avatar: t._assignee[0].avatar } : null,
      createdBy: t._createdBy?.[0] ? { _id: t._createdBy[0]._id, name: t._createdBy[0].name } : null,
      _assignee: undefined, _createdBy: undefined,
    }));

    return { tasks: data, total, page, pages: Math.ceil(total / limit) };
  }, TaskSchemas.List)

  // ─── GET ONE ──────────────────────────────────────────────────────────────
  .get('/:id', async ({ params, set }) => {
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await TaskService.populateTask(oid);
    if (!task) { set.status = 404; return { message: 'Task not found' }; }
    return task;
  })

  // ─── UPDATE ───────────────────────────────────────────────────────────────
  .put('/:id', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await collections.tasks().findOne({ _id: oid });
    if (!task) { set.status = 404; return { message: 'Task not found' }; }
    const actor = user.employeeId ? toOid(user.employeeId) : null;
    if (!actor) { set.status = 400; return { message: 'User has no linked employee profile' }; }

    const updates: any = { ...body };
    const oldStatus = task.status;
    const oldPriority = task.priority;
    const oldAssigneeId = task.assignee?.toString() ?? null;
    const oldTitle = task.title;
    const oldDueDateStr = task.dueDate ? new Date(task.dueDate).toDateString() : null;

    if (updates.dueDate !== undefined) updates.dueDate = updates.dueDate ? parseDate(updates.dueDate) : null;
    if (updates.startDate !== undefined) updates.startDate = updates.startDate ? parseDate(updates.startDate) : null;
    if (updates.assignee !== undefined) updates.assignee = updates.assignee ? toOid(updates.assignee) : null;

    if (updates.status) {
      if (updates.status === 'done' && oldStatus !== 'done') updates.completedAt = new Date();
      else if (updates.status !== 'done' && oldStatus === 'done') updates.completedAt = null;
    }

    const activityAdds: TaskActivityLog[] = [];
    if (updates.status && updates.status !== oldStatus) {
      activityAdds.push(TaskService.buildActivity('status_changed', actor,
        `Status changed from "${STATUS_LABEL[oldStatus || ''] || oldStatus}" to "${STATUS_LABEL[updates.status] || updates.status}"`,
        { from: oldStatus, to: updates.status }));
    }
    if (updates.priority && updates.priority !== oldPriority) {
      activityAdds.push(TaskService.buildActivity('priority_changed', actor,
        `Priority changed from "${PRIORITY_LABEL[oldPriority || '']}" to "${PRIORITY_LABEL[updates.priority]}"`,
        { from: oldPriority, to: updates.priority }));
    }
    if (updates.assignee !== undefined) {
      const newAssigneeId = updates.assignee?.toString() ?? null;
      if (newAssigneeId !== oldAssigneeId) {
        activityAdds.push(TaskService.buildActivity('assigned', actor,
          updates.assignee ? 'Task reassigned' : 'Assignee removed',
          { from: oldAssigneeId, to: newAssigneeId }));
      }
    }
    if (updates.title && updates.title !== oldTitle) {
      activityAdds.push(TaskService.buildActivity('title_changed', actor, `Title changed to "${updates.title}"`, { from: oldTitle, to: updates.title }));
    }
    if (updates.dueDate !== undefined) {
      const newStr = updates.dueDate ? new Date(updates.dueDate).toDateString() : null;
      if (newStr !== oldDueDateStr) {
        activityAdds.push(TaskService.buildActivity('due_changed', actor,
          updates.dueDate ? `Due date set to ${new Date(updates.dueDate).toLocaleDateString('en-IN')}` : 'Due date removed',
          { from: oldDueDateStr, to: newStr }));
      }
    }

    if (task.subtasks && task.subtasks.length > 0) {
      updates.progress = TaskService.calcSubtaskProgress(task.subtasks);
    }
    updates.updatedAt = new Date();

    const setOps: any = {};
    const unsetOps: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) unsetOps[k] = '';
      else setOps[k] = v;
    }

    const update: any = {};
    if (Object.keys(setOps).length) update.$set = setOps;
    if (Object.keys(unsetOps).length) update.$unset = unsetOps;
    if (activityAdds.length) update.$push = { activityLog: { $each: activityAdds } };

    await collections.tasks().updateOne({ _id: oid }, update);

    if (updates.status && updates.status !== oldStatus) {
      const fresh = await collections.tasks().findOne({ _id: oid });
      if (fresh) TaskService.sendStatusChangeNotifications(fresh, oldStatus || '', updates.status, actor).catch(() => {});
    }

    return await TaskService.populateLight(oid);
  }, TaskSchemas.Update)

  // ─── DELETE ───────────────────────────────────────────────────────────────
  .delete('/:id', async ({ user, params, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await collections.tasks().findOne({ _id: oid });
    if (!task) { set.status = 404; return { message: 'Task not found' }; }

    const isAdmin = user.role === 'admin' || user.role === 'hr';
    const actor = user.employeeId;
    const isCreator = task.createdBy?.toString() === actor;
    const isAssignee = task.assignee?.toString() === actor;

    if (!isAdmin && !isCreator && !isAssignee) {
      set.status = 403;
      return { message: 'Only the task creator, assignee, or admin can cancel this task' };
    }

    if (isAdmin) {
      await collections.tasks().deleteOne({ _id: oid });
      return { message: 'Task permanently deleted' };
    }

    await collections.tasks().updateOne({ _id: oid }, { $set: { status: 'cancelled', updatedAt: new Date() } });
    const updated = await collections.tasks().findOne({ _id: oid });
    return { message: 'Task cancelled', task: updated };
  })

  // ─── ADD COMMENT ──────────────────────────────────────────────────────────
  .post('/:id/comments', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await collections.tasks().findOne({ _id: oid });
    if (!task) { set.status = 404; return { message: 'Task not found' }; }
    const author = user.employeeId ? toOid(user.employeeId) : null;
    if (!author) { set.status = 400; return { message: 'User has no linked employee profile' }; }

    const text = body.text.trim();
    const comment = { author, text, createdAt: new Date() };
    const activity = TaskService.buildActivity('comment_added', author,
      `Added a comment: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);

    await collections.tasks().updateOne({ _id: oid }, {
      $push: { comments: comment, activityLog: activity } as any,
      $set: { updatedAt: new Date() },
    });

    const populated = await TaskService.populateTask(oid);
    set.status = 201;
    return { comments: populated?.comments, activityLog: populated?.activityLog };
  }, TaskSchemas.Comment)

  // ─── ADD SUBTASK ──────────────────────────────────────────────────────────
  .post('/:id/subtasks', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await collections.tasks().findOne({ _id: oid });
    if (!task) { set.status = 404; return { message: 'Task not found' }; }
    const actor = user.employeeId ? toOid(user.employeeId) : null;
    if (!actor) { set.status = 400; return { message: 'No employee profile' }; }

    const title = body.title.trim();
    const subtask: any = { title, completed: false };
    if (body.assignee) {
      const a = toOid(body.assignee);
      if (a) subtask.assignee = a;
    }

    const newSubtasks = [...(task.subtasks || []), subtask];
    const progress = TaskService.calcSubtaskProgress(newSubtasks);

    await collections.tasks().updateOne({ _id: oid }, {
      $push: {
        subtasks: subtask,
        activityLog: TaskService.buildActivity('subtask_added', actor, `Subtask added: "${title}"`),
      } as any,
      $set: { progress, updatedAt: new Date() },
    });

    const updated = await collections.tasks().findOne({ _id: oid });
    set.status = 201;
    return updated?.subtasks;
  }, TaskSchemas.Subtask)

  // ─── TOGGLE SUBTASK ───────────────────────────────────────────────────────
  .put('/:id/subtasks/:subtaskIndex/toggle', async ({ user, params, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await collections.tasks().findOne({ _id: oid });
    if (!task) { set.status = 404; return { message: 'Task not found' }; }
    const actor = user.employeeId ? toOid(user.employeeId) : null;
    if (!actor) { set.status = 400; return { message: 'No employee profile' }; }

    const idx = Number(params.subtaskIndex);
    const subtasks = task.subtasks || [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= subtasks.length) {
      set.status = 400; return { message: 'Invalid subtask index' };
    }

    const subtask = subtasks[idx];
    subtask.completed = !subtask.completed;
    subtask.completedAt = subtask.completed ? new Date() : undefined;
    const progress = TaskService.calcSubtaskProgress(subtasks);

    const activity = TaskService.buildActivity(
      subtask.completed ? 'subtask_completed' : 'subtask_reopened',
      actor,
      subtask.completed ? `Subtask completed: "${subtask.title}"` : `Subtask reopened: "${subtask.title}"`,
    );

    await collections.tasks().updateOne({ _id: oid }, {
      $set: { subtasks, progress, updatedAt: new Date() },
      $push: { activityLog: activity } as any,
    });

    return { subtask, progress };
  })

  // ─── LOG TIME ─────────────────────────────────────────────────────────────
  .post('/:id/time', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await collections.tasks().findOne({ _id: oid });
    if (!task) { set.status = 404; return { message: 'Task not found' }; }
    const actor = user.employeeId ? toOid(user.employeeId) : null;
    if (!actor) { set.status = 400; return { message: 'No employee profile' }; }

    const entry = { employee: actor, hours: body.hours, description: body.description, date: new Date() };
    const newLogged = (task.loggedHours || 0) + body.hours;
    const activity = TaskService.buildActivity('time_logged', actor,
      `Logged ${body.hours}h${body.description ? ` — ${body.description}` : ''}`);

    await collections.tasks().updateOne({ _id: oid }, {
      $push: { timeEntries: entry, activityLog: activity } as any,
      $set: { loggedHours: newLogged, updatedAt: new Date() },
    });

    const updated = await collections.tasks().findOne({ _id: oid });
    set.status = 201;
    return {
      loggedHours: updated?.loggedHours,
      estimatedHours: updated?.estimatedHours,
      timeEntries: updated?.timeEntries,
    };
  }, TaskSchemas.LogTime)

  // ─── UPLOAD ATTACHMENT ────────────────────────────────────────────────────
  .post('/:id/attachments', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const oid = toOid(params.id);
    if (!oid) { set.status = 400; return { message: 'Invalid task id' }; }
    const task = await collections.tasks().findOne({ _id: oid });
    if (!task) { set.status = 404; return { message: 'Task not found' }; }
    const actor = user.employeeId ? toOid(user.employeeId) : null;
    if (!actor) { set.status = 400; return { message: 'No employee profile' }; }

    const file = body.file;
    if (!file) { set.status = 400; return { message: 'No file uploaded' }; }

    const key = buildUploadKey({
      purpose: 'task',
      contentType: file.type || 'application/octet-stream',
      filename: file.name,
      taskId: params.id,
    });
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type || 'application/octet-stream');

    const attachment = {
      fileName: file.name,
      fileUrl: key,
      fileSize: file.size,
      uploadedBy: actor,
      uploadedAt: new Date(),
    };
    const activity = TaskService.buildActivity('attachment_added', actor, `Attached file: "${file.name}"`);

    await collections.tasks().updateOne({ _id: oid }, {
      $push: { attachments: attachment, activityLog: activity } as any,
      $set: { updatedAt: new Date() },
    });

    set.status = 201;
    return await TaskService.populateLight(oid);
  }, TaskSchemas.Attachment))

  // Silence unused-import lint
  .decorate('_unused', { VALID_STATUSES });
