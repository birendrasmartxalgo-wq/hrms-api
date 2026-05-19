import { Elysia } from 'elysia';
import { AdminSchemas } from './schema';
import { AdminService } from './service';
import { authPlugin } from '../../plugins/auth';
import { forbidden } from '../../errors';

export const adminController = new Elysia({ prefix: '/admin' })
  .use(authPlugin)

  // GET /api/admin/dashboard
  .get('/dashboard', async ({ user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getDashboardStats();
  }, { authorize: true as const })

  // GET /api/admin/activity
  .get('/activity', async ({ user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getRecentActivity();
  }, { authorize: true as const })

  // GET /api/admin/departments
  .get('/departments', async ({ user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getDepartmentBreakdown();
  }, { authorize: true as const })

  // GET /api/admin/doc-deadline-warnings
  .get('/doc-deadline-warnings', async ({ user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getDocDeadlineWarnings();
  }, { authorize: true as const })

  // GET /api/admin/office-settings
  .get('/office-settings', async ({ user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getOfficeSettings();
  }, { authorize: true as const })

  // PUT /api/admin/office-settings
  .put('/office-settings', async ({ body, user }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    await AdminService.updateOfficeSettings(body, user.userId);
    return { message: 'Office settings updated' };
  }, { ...AdminSchemas.OfficeSettingsPut, authorize: true as const })

  // GET /api/admin/attendance-settings
  .get('/attendance-settings', async ({ user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getAttendanceSettings();
  }, { authorize: true as const })

  // PUT /api/admin/attendance-settings
  .put('/attendance-settings', async ({ body, user }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    await AdminService.updateAttendanceSettings(body, user.userId);
    return { message: 'Attendance settings updated' };
  }, { ...AdminSchemas.AttendanceSettingsPut, authorize: true as const })

  // GET /api/admin/payroll-period-settings
  .get('/payroll-period-settings', async ({ user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getPayrollPeriodSettings();
  }, { authorize: true as const })

  // PUT /api/admin/payroll-period-settings
  .put('/payroll-period-settings', async ({ body, user }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    await AdminService.updatePayrollPeriodSettings(body, user.userId);
    return { message: 'Payroll period settings updated' };
  }, { ...AdminSchemas.PayrollPeriodSettingsPut, authorize: true as const })

  // GET /api/admin/punch-selfies
  .get('/punch-selfies', async ({ query, user }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    return await AdminService.getPunchSelfies(query.date);
  }, { ...AdminSchemas.PunchSelfies, authorize: true as const });
