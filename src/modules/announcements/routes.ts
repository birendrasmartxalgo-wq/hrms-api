import { Elysia, t } from 'elysia';
import { authPlugin } from '../../plugins/auth';
import { AnnouncementService } from './service';

const AnnouncementBody = t.Object({
  title: t.String({ minLength: 1 }),
  body: t.String({ minLength: 1 }),
  priority: t.Optional(t.Union([t.Literal('normal'), t.Literal('important'), t.Literal('urgent')])),
  department: t.Optional(t.String()),
});

export const announcementRoutes = new Elysia({ prefix: '/announcements', name: 'announcements' })
  .use(authPlugin)
  .get(
    '/',
    async ({ query }) => ({
      data: await AnnouncementService.list(query.limit ? Number(query.limit) : 20),
    }),
    {
      authorize: true,
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['Announcements'] },
    },
  )
  .post(
    '/',
    async ({ body, status, ...context }) => {
      const data = await AnnouncementService.create((context as any).user, body);
      return status(201, { message: 'Announcement created', data });
    },
    { authorize: ['admin', 'hr'], body: AnnouncementBody, detail: { tags: ['Announcements'] } },
  )
  .delete(
    '/:id',
    async ({ params, ...context }) => {
      await AnnouncementService.delete((context as any).user, params.id);
      return { message: 'Deleted' };
    },
    { authorize: ['admin', 'hr'], detail: { tags: ['Announcements'] } },
  );
