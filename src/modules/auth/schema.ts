import { t } from 'elysia';

export const AuthSchemas = {
  Register: {
    body: t.Object({
      email: t.String(),
      password: t.String(),
      name: t.String(),
      role: t.Optional(t.String()),
      empId: t.Optional(t.String()),
      department: t.Optional(t.String()),
      designation: t.Optional(t.String()),
    })
  },
  Login: {
    body: t.Object({
      email: t.String(),
      password: t.String(),
    }),
    query: t.Object({
      client: t.Optional(t.String()),
    })
  },
  Refresh: {
    body: t.Object({
      refreshToken: t.String(),
    })
  },
  ForgotPassword: {
    body: t.Object({
      email: t.String(),
    })
  },
  VerifyOtp: {
    body: t.Object({
      email: t.String(),
      otp: t.String(),
    })
  },
  ResetPassword: {
    body: t.Object({
      email: t.String(),
      resetToken: t.String(),
      newPassword: t.String(),
      confirmPassword: t.String(),
    })
  }
};
