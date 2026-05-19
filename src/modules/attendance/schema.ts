import { t } from 'elysia';

export const AttendanceSchemas = {
  Punch: {
    body: t.Object({
      lat: t.Numeric(),
      lng: t.Numeric(),
      accuracy: t.Optional(t.Numeric()),
      source: t.Optional(t.String()),
      selfie: t.Optional(t.File()),
      // Alternative to multipart `selfie`: a pre-uploaded S3 key obtained via /uploads/sign.
      selfieKey: t.Optional(t.String({ minLength: 1 })),
    }),
  },
  StartBreak: {
    body: t.Object({
      lat: t.Optional(t.Numeric()),
      lng: t.Optional(t.Numeric()),
      type: t.Optional(t.String()),
    }),
  },
  EndBreak: {
    body: t.Object({
      lat: t.Optional(t.Numeric()),
      lng: t.Optional(t.Numeric()),
    }),
  },
  ActivityStatus: {
    body: t.Object({
      status: t.Union([t.Literal('active'), t.Literal('idle')]),
    }),
  },
  RepunchApprove: {
    body: t.Optional(t.Object({
      remarks: t.Optional(t.String()),
    })),
  },
  Regularize: {
    body: t.Object({
      punchInTime: t.Optional(t.String()),
      punchOutTime: t.Optional(t.String()),
      reason: t.Optional(t.String()),
    }),
  },
};
