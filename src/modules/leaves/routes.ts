import { Elysia, t } from 'elysia';
import { authPlugin } from '../../plugins/auth';
import { LeaveService } from './service';

const LeaveType = t.Union([
  t.Literal('CL'),
  t.Literal('SL'),
  t.Literal('EL'),
  t.Literal('CO'),
  t.Literal('LOP'),
  t.Literal('ML'),
  t.Literal('PL'),
  t.Literal('BL'),
]);

const LeaveStatus = t.Union([
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('rejected'),
  t.Literal('cancelled'),
  t.Literal('withdrawn'),
]);

const ApplyLeaveBody = t.Object({
  leaveType: LeaveType,
  startDate: t.String(),
  endDate: t.String(),
  halfDay: t.Optional(t.Boolean()),
  halfDayPeriod: t.Optional(t.Union([t.Literal('morning'), t.Literal('afternoon')])),
  reason: t.String({ minLength: 1 }),
});

const RemarksBody = t.Object({
  remarks: t.Optional(t.String()),
});

const RequiredRemarksBody = t.Object({
  remarks: t.String({ minLength: 1 }),
});

const TextBody = t.Object({
  text: t.String({ minLength: 1 }),
});

const AttachmentBody = t.Object({
  file: t.File(),
});

export const leaveRoutes = new Elysia({ prefix: '/leaves', name: 'leaves' })
  .use(authPlugin)
  .post(
    '/',
    async ({ body, status, ...context }) => {
      const data = await LeaveService.apply((context as any).user, body);
      return status(201, { message: 'Leave applied successfully', data });
    },
    { authorize: true, body: ApplyLeaveBody, detail: { tags: ['Leaves'] } },
  )
  // GET /leaves — caller's own leaves. Alias for /my to match docs/07.
  .get(
    '/',
    async ({ ...context }) => ({ data: await LeaveService.my((context as any).user) }),
    { authorize: true, detail: { tags: ['Leaves'], summary: 'List the caller\'s own leaves' } },
  )
  .get(
    '/my',
    async ({ ...context }) => ({ data: await LeaveService.my((context as any).user) }),
    { authorize: true, detail: { tags: ['Leaves'] } },
  )
  .get(
    '/balance',
    async ({ ...context }) => LeaveService.myBalance((context as any).user),
    { authorize: true, detail: { tags: ['Leaves'] } },
  )
  .get(
    '/balance/:empId',
    async ({ params }) => LeaveService.employeeBalance(params.empId),
    { authorize: ['admin', 'hr'], detail: { tags: ['Leaves'] } },
  )
  .get(
    '/summary',
    async ({ ...context }) => LeaveService.summary((context as any).user),
    { authorize: ['admin', 'hr'], detail: { tags: ['Leaves'] } },
  )
  .get(
    '/pending',
    async ({ ...context }) => ({ data: await LeaveService.pending((context as any).user) }),
    { authorize: ['admin', 'hr'], detail: { tags: ['Leaves'] } },
  )
  .get(
    '/all',
    async ({ query, ...context }) => ({
      data: await LeaveService.all((context as any).user, query),
    }),
    {
      authorize: ['admin', 'hr'],
      query: t.Object({
        status: t.Optional(LeaveStatus),
        employeeId: t.Optional(t.String()),
      }),
      detail: { tags: ['Leaves'] },
    },
  )
  .patch(
    '/:id/approve',
    async ({ params, body, ...context }) => ({
      message: 'Leave approved',
      data: await LeaveService.approve((context as any).user, params.id, body.remarks ?? ''),
    }),
    { authorize: ['admin', 'hr'], body: RemarksBody, detail: { tags: ['Leaves'] } },
  )
  .patch(
    '/:id/reject',
    async ({ params, body, ...context }) => ({
      message: 'Leave rejected',
      data: await LeaveService.reject((context as any).user, params.id, body.remarks),
    }),
    { authorize: ['admin', 'hr'], body: RequiredRemarksBody, detail: { tags: ['Leaves'] } },
  )
  .patch(
    '/:id/withdraw',
    async ({ params, ...context }) => {
      await LeaveService.withdraw((context as any).user, params.id);
      return { message: 'Leave withdrawn successfully' };
    },
    { authorize: true, detail: { tags: ['Leaves'] } },
  )
  .patch(
    '/:id/cancel',
    async ({ params, ...context }) => {
      await LeaveService.cancel((context as any).user, params.id);
      return { message: 'Leave cancelled successfully' };
    },
    { authorize: true, detail: { tags: ['Leaves'] } },
  )
  .patch(
    '/:id/admin-cancel',
    async ({ params, body, ...context }) => ({
      message: 'Leave cancelled',
      data: await LeaveService.adminCancel((context as any).user, params.id, body.remarks),
    }),
    { authorize: ['admin', 'hr'], body: RequiredRemarksBody, detail: { tags: ['Leaves'] } },
  )
  .post(
    '/:id/question',
    async ({ params, body, ...context }) => ({
      message: 'Question added',
      data: await LeaveService.askQuestion((context as any).user, params.id, body.text),
    }),
    { authorize: ['admin', 'hr'], body: TextBody, detail: { tags: ['Leaves'] } },
  )
  .post(
    '/:id/question/:qid/reply',
    async ({ params, body, ...context }) => ({
      message: 'Reply added',
      data: await LeaveService.replyToQuestion((context as any).user, params.id, params.qid, body.text),
    }),
    { authorize: true, body: TextBody, detail: { tags: ['Leaves'] } },
  )
  .post(
    '/:id/attachment',
    async ({ params, body, ...context }) => {
      const result = await LeaveService.uploadAttachment((context as any).user, params.id, body.file);
      return {
        message: 'Attachment uploaded',
        key: result.attachment.key,
        url: result.attachment.url,
        name: result.attachment.name,
        attachments: result.leave.attachments,
      };
    },
    { authorize: true, body: AttachmentBody, detail: { tags: ['Leaves'] } },
  );
