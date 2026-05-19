import { Elysia, t } from 'elysia';
import { buildUploadKey, presignPut, presignGet } from '../../services/s3';

const UploadPurpose = t.Union([
  t.Literal('selfie'),
  t.Literal('document'),
  t.Literal('avatar'),
  t.Literal('chat'),
  t.Literal('leave'),
  t.Literal('task'),
  t.Literal('payroll-import'),
  t.Literal('payroll-slip'),
]);

const SignUploadBody = t.Object({
  purpose: UploadPurpose,
  contentType: t.String({ minLength: 1 }),
  filename: t.Optional(t.String({ minLength: 1 })),
  employeeId: t.Optional(t.String({ minLength: 1 })),
  docId: t.Optional(t.String({ minLength: 1 })),
  conversationId: t.Optional(t.String({ minLength: 1 })),
  messageId: t.Optional(t.String({ minLength: 1 })),
  leaveId: t.Optional(t.String({ minLength: 1 })),
  taskId: t.Optional(t.String({ minLength: 1 })),
  payrollMonth: t.Optional(t.String({ minLength: 7, maxLength: 7 })),
  expiresIn: t.Optional(t.Number({ minimum: 1, maximum: 604800 })),
});

export const uploadRoutes = new Elysia({ name: 'uploads' })
  .post(
    '/uploads/sign',
    async ({ body, ...context }) => {
      const user = (context as { user?: { employeeId?: string } | null }).user;
      const key = buildUploadKey(body, { actorEmployeeId: user?.employeeId });
      const signed = await presignPut(key, body.contentType, body.expiresIn);

      return {
        ...signed,
        fields: {},
      };
    },
    {
      authorize: true,
      body: SignUploadBody,
      detail: {
        tags: ['Uploads'],
        summary: 'Create a presigned S3 PUT URL',
        description: 'Client must PUT bytes to url with the returned headers exactly.',
      },
    },
  )

  // POST /uploads/sign-get — create a presigned GET URL for a known key.
  // Intended for fetching chat attachments / avatars on private buckets.
  .post(
    '/uploads/sign-get',
    async ({ body }) => {
      const signed = await presignGet(body.key, body.expiresIn, { filename: body.filename });
      return signed;
    },
    {
      authorize: true,
      body: t.Object({
        key: t.String({ minLength: 1 }),
        filename: t.Optional(t.String({ minLength: 1 })),
        expiresIn: t.Optional(t.Number({ minimum: 1, maximum: 604800 })),
      }),
      detail: {
        tags: ['Uploads'],
        summary: 'Create a presigned S3 GET URL',
      },
    },
  );
