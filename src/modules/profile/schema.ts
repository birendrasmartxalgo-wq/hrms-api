import { t } from 'elysia';

export const ProfileSchemas = {
  UpdateMe: {
    body: t.Object({
      name: t.Optional(t.String()),
      phone: t.Optional(t.String()),
      emergencyContact: t.Optional(t.String()),
      address: t.Optional(t.String()),
      dateOfBirth: t.Optional(t.String()),
      bloodGroup: t.Optional(t.String()),
      personalEmail: t.Optional(t.String()),
      linkedIn: t.Optional(t.String()),
      bio: t.Optional(t.String()),
    }),
  },
  ChangePassword: {
    body: t.Object({
      currentPassword: t.String(),
      newPassword: t.String(),
    }),
  },
  AdminChangePassword: {
    params: t.Object({
      userId: t.String(),
    }),
    body: t.Object({
      newPassword: t.String(),
    }),
  },
  Employee: {
    params: t.Object({
      empId: t.String(),
    }),
  },
};
