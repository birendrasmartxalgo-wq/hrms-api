import { Elysia } from 'elysia';
import { authPlugin } from '../../plugins/auth';
import { NotificationService } from './service';

export const notificationRoutes = new Elysia({ prefix: '/notifications', name: 'notifications' })
  .use(authPlugin)
  .get(
    '/',
    async ({ ...context }) => ({ data: await NotificationService.list((context as any).user) }),
    { authorize: true, detail: { tags: ['Notifications'] } },
  )
  .patch(
    '/read-all',
    async ({ ...context }) => {
      await NotificationService.readAll((context as any).user);
      return { message: 'All marked read' };
    },
    { authorize: true, detail: { tags: ['Notifications'] } },
  )
  .patch(
    '/:id/read',
    async ({ params, ...context }) => {
      await NotificationService.readOne((context as any).user, params.id);
      return { message: 'Marked read' };
    },
    { authorize: true, detail: { tags: ['Notifications'] } },
  )
  .delete(
    '/:id',
    async ({ params, ...context }) => {
      await NotificationService.dismiss((context as any).user, params.id);
      return { message: 'Dismissed' };
    },
    { authorize: true, detail: { tags: ['Notifications'] } },
  );
