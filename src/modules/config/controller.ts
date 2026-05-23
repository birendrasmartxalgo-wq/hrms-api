import { Elysia, t } from 'elysia';
import { env } from '../../env';
import { authPlugin } from '../../plugins/auth';
import { collections } from '../../db/collections';

export const configController = new Elysia({ prefix: '/config' })
  .use(authPlugin)
  .get('/mobile-version', () => ({
    minVersion: env.MOBILE_MIN_VERSION,
    currentVersion: env.MOBILE_CURRENT_VERSION,
  }))

  // GET /api/v1/config/office-location — minimal geofence for client-side pre-checks.
  // Mirrors what /admin/office-settings exposes but is readable by any authed user.
  .get('/office-location', async ({ user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const settings = await collections.settings().findOne({ key: 'office' });
    const lat = (settings as any)?.value?.lat ?? env.OFFICE_LAT;
    const lng = (settings as any)?.value?.lng ?? env.OFFICE_LNG;
    const radiusM = (settings as any)?.value?.radiusM ?? env.OFFICE_RADIUS_M ?? 100;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      // Not configured — return null so the client knows to skip pre-check.
      return { lat: null, lng: null, radiusM };
    }
    return { lat, lng, radiusM };
  }, { authorize: true as const })

  // GET /api/v1/config/holidays?year=&month=
  // Returns the org-wide holiday list. Mobile uses this in two places:
  //   1. apps/mobile/app/holidays.tsx — yearly list with hero/upcoming/past
  //   2. apps/mobile/app/(tabs)/calendar.tsx — month grid markers
  // Day/month/year are pre-extracted so RN doesn't have to parse Date strings
  // back into components for every render.
  .get(
    '/holidays',
    async ({ query, user, set }: any) => {
      if (!user) {
        set.status = 401;
        return { message: 'Unauthorized' };
      }
      const year = Number(query?.year) || new Date().getFullYear();
      const filter: any = { year };
      if (query?.month) {
        const m = Number(query.month);
        if (m >= 1 && m <= 12) {
          const start = new Date(year, m - 1, 1);
          const end = new Date(year, m, 0, 23, 59, 59);
          filter.date = { $gte: start, $lte: end };
        }
      }
      const rows = await collections.holidays().find(filter).sort({ date: 1 }).toArray();
      return rows.map((h) => {
        const d = new Date(h.date);
        return {
          _id: h._id.toString(),
          day: d.getDate(),
          month: d.getMonth() + 1,
          year: h.year,
          name: h.name,
          weekday: d.toLocaleDateString('en-IN', { weekday: 'long' }),
          type: h.type ?? 'national',
        };
      });
    },
    {
      authorize: true as const,
      query: t.Optional(
        t.Object({
          year: t.Optional(t.String()),
          month: t.Optional(t.String()),
        }),
      ),
      detail: { tags: ['Config'], summary: 'List holidays for a year (and optional month)' },
    },
  );
