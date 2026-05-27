import { Elysia } from 'elysia';
import { connectDb } from './db/client';
import { env } from './env';
import { announcementRoutes } from './modules/announcements/routes';
import { adminController } from './modules/admin/controller';
import { authController } from './modules/auth/controller';
import { attendanceController } from './modules/attendance/controller';
import { configController } from './modules/config/controller';
import { employeesController } from './modules/employees/controller';
import { profileController } from './modules/profile/controller';
import { taskController } from './modules/tasks/controller';
import { chatController } from './modules/chat/controller';
import { payrollController } from './modules/payroll/controller';
import { payrollAdminController } from './modules/payroll/adminController';
import { leaveRoutes } from './modules/leaves/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { uploadRoutes } from './modules/uploads/routes';
import { authPlugin } from './plugins/auth';
import { corsPlugin } from './plugins/cors';
import { errorPlugin } from './plugins/error';
import { loggerPlugin } from './plugins/logger';
import { requestIdPlugin } from './plugins/requestId';
import { swaggerPlugin } from './plugins/swagger';
import { wsPlugin } from './ws/server';
import { cron } from '@elysiajs/cron';
import { runAutoPunchOut } from './jobs/autoPunchOut';

export const app = new Elysia({
  prefix: `/api/${env.API_VERSION}`,
  name: 'hrms-api',
})
  .use(errorPlugin)
  .use(requestIdPlugin)
  .use(corsPlugin)
  .use(swaggerPlugin)
  .use(authPlugin)
  .use(authController)
  .use(configController)
  .use(employeesController)
  .use(adminController)
  .use(profileController)
  .use(attendanceController)
  .use(taskController)
  .use(chatController)
  .use(payrollController)
  .use(payrollAdminController)
  .use(uploadRoutes)
  .use(leaveRoutes)
  .use(notificationRoutes)
  .use(announcementRoutes)
  .use(wsPlugin)
  .use(
    cron({
      name: 'auto-punch-out',
      // 0 13 * * * UTC = 6:30 PM IST daily (spec: non-http-behaviors.md §Cron)
      pattern: '0 13 * * *',
      timezone: 'UTC',
      async run() {
        console.log('[cron:auto-punch-out] Triggered at 6:30 PM IST');
        await runAutoPunchOut();
      },
    }),
  )
  .use(loggerPlugin)
  .onStart(async () => {
    await connectDb();
    console.log('[hrms-api] mongodb connected');
  })
  .get('/health', () => ({
    ok: true,
    version: env.API_VERSION,
    ts: new Date().toISOString(),
  }));

if (import.meta.main) {
  app.listen({ port: env.API_PORT, hostname: env.HOST }, ({ hostname, port }) => {
    console.log(
      `[hrms-api] listening on http://${hostname}:${port}/api/${env.API_VERSION} (env=${env.NODE_ENV})`,
    );
  });
}

export type App = typeof app;
