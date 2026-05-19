import { t } from 'elysia';

const StatusEnum = t.Union([
  t.Literal('backlog'),
  t.Literal('todo'),
  t.Literal('in_progress'),
  t.Literal('in_review'),
  t.Literal('done'),
  t.Literal('cancelled'),
]);

const PriorityEnum = t.Union([
  t.Literal('urgent'),
  t.Literal('high'),
  t.Literal('medium'),
  t.Literal('low'),
  t.Literal('none'),
]);

export const TaskSchemas = {
  Create: {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      assignee: t.Optional(t.String()),
      project: t.Optional(t.String()),
      tags: t.Optional(t.Array(t.String())),
      priority: t.Optional(PriorityEnum),
      dueDate: t.Optional(t.String()),
      startDate: t.Optional(t.String()),
      estimatedHours: t.Optional(t.Number()),
      parentTask: t.Optional(t.String()),
    }),
  },
  List: {
    query: t.Object({
      status: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      assignee: t.Optional(t.String()),
      project: t.Optional(t.String()),
      tag: t.Optional(t.String()),
      search: t.Optional(t.String()),
      dueDate: t.Optional(t.String()),
      sort: t.Optional(t.String()),
      view: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  },
  Update: {
    body: t.Partial(t.Object({
      title: t.String(),
      description: t.String(),
      assignee: t.Union([t.String(), t.Null()]),
      project: t.String(),
      tags: t.Array(t.String()),
      priority: PriorityEnum,
      status: StatusEnum,
      dueDate: t.Union([t.String(), t.Null()]),
      startDate: t.Union([t.String(), t.Null()]),
      estimatedHours: t.Number(),
      progress: t.Number(),
    })),
  },
  Comment: {
    body: t.Object({ text: t.String({ minLength: 1 }) }),
  },
  Subtask: {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      assignee: t.Optional(t.String()),
    }),
  },
  LogTime: {
    body: t.Object({
      hours: t.Number({ minimum: 0.01 }),
      description: t.Optional(t.String()),
    }),
  },
  BulkStatus: {
    body: t.Object({
      taskIds: t.Array(t.String(), { minItems: 1 }),
      status: StatusEnum,
    }),
  },
  Kanban: {
    query: t.Object({
      project: t.Optional(t.String()),
      assignee: t.Optional(t.String()),
    }),
  },
  Attachment: {
    body: t.Object({
      file: t.File({ maxSize: '25m' }),
    }),
  },
};
