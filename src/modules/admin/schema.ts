import { t } from 'elysia';

export const AdminSchemas = {
  PunchSelfies: {
    query: t.Object({
      date: t.Optional(t.String()),
    }),
  },
  OfficeSettingsPut: {
    body: t.Object({
      name: t.String(),
      lat: t.Number(),
      lng: t.Number(),
      radiusMetres: t.Number(),
    }),
  },
  AttendanceSettingsPut: {
    body: t.Object({
      roles: t.Array(t.String()),
    }),
  },
  PayrollPeriodSettingsPut: {
    body: t.Object({
      startDay: t.Number(),
      endDay: t.Number(),
    }),
  },
};
