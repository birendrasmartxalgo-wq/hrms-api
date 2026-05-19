import { Elysia, t } from 'elysia';
import { EmployeeSchemas } from './schema';
import { EmployeesService } from './service';
import { authPlugin } from '../../plugins/auth';
import { buildUploadKey, putObject } from '../../services/s3';
import { forbidden } from '../../errors';

export const employeesController = new Elysia({ prefix: '/employees' })
  .use(authPlugin)

  // GET /api/employees/stats
  .get('/stats', async ({ user, set }: any) => {
    if (!user) return unauthorized(set);
    const stats = await EmployeesService.getEnrollmentStats();
    return stats;
  }, { authorize: true as const })

  // GET /api/employees/pending-approvals
  .get('/pending-approvals', async ({ user, set }: any) => {
    if (!user) return unauthorized(set);
    const result = await EmployeesService.getPendingApprovals();
    return result;
  }, { authorize: true as const })

  // GET /api/employees
  .get('/', async ({ query, user, set }: any): Promise<any> => {
    if (!user) return unauthorized(set);
    const result = await EmployeesService.listEmployees({
      search: query.search,
      department: query.department,
      status: query.status,
      employmentStatus: query.employmentStatus,
      onboardingStatus: query.onboardingStatus,
      tab: query.tab,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
    return result;
  }, { ...EmployeeSchemas.List, authorize: true as const })

  // GET /api/employees/:id
  .get('/:id', async ({ params, user, set }: any) => {
    if (!user) return unauthorized(set);
    const employee = await EmployeesService.getEmployee(params.id);
    if (!employee) {
      set.status = 404;
      return { message: 'Employee not found' };
    }
    return { employee };
  }, { ...EmployeeSchemas.Detail, authorize: true as const })

  // POST /api/employees
  .post('/', async ({ body, user, set }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    const result = await EmployeesService.enrollEmployee(body);
    set.status = result.status;
    return result;
  }, { ...EmployeeSchemas.Create, authorize: true as const })

  // PUT /api/employees/:id
  .put('/:id', async ({ params, body, user, set }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    const result = await EmployeesService.updateEmployee(params.id, body);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Employee updated' };
  }, { ...EmployeeSchemas.Update, authorize: true as const })

  // DELETE /api/employees/:id
  .delete('/:id', async ({ params, user, set }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    const result = await EmployeesService.deleteEmployee(params.id, user.userId);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Employee deleted' };
  }, { ...EmployeeSchemas.Delete, authorize: true as const })

  // POST /api/employees/:id/force-logout
  .post('/:id/force-logout', async ({ params, user, set }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    const result = await EmployeesService.forceLogout(params.id);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'User forced logout' };
  }, { ...EmployeeSchemas.ForceLogout, authorize: true as const })

  // POST /api/employees/:id/documents/by-key — JSON sibling of the multipart
  // upload route. Mobile uploads bytes via presigned PUT first (RN FormData
  // doesn't interop with Eden's multipart detector, see DOCS.md D9), then
  // calls this to register the resulting S3 key against the employee record.
  // Keep the multipart route below intact — web admin still uses it.
  .post(
    '/:id/documents/by-key',
    async ({ params, body, user, set }: any) => {
      if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
      const { key, name, size, contentType, docType } = body;
      const result = await EmployeesService.uploadDocument(
        params.id,
        { name, size, type: contentType, key },
        docType,
      );
      set.status = result.status;
      if (!result.ok) return { message: result.message };
      return { message: 'Document registered', key };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        key: t.String({ minLength: 1 }),
        name: t.String({ minLength: 1 }),
        size: t.Number({ minimum: 0 }),
        contentType: t.String({ minLength: 1 }),
        docType: t.String({ minLength: 1 }),
      }),
      authorize: true as const,
      detail: {
        tags: ['Employees'],
        summary: 'Register a document by its pre-uploaded S3 key',
      },
    },
  )

  // POST /api/employees/:id/documents - multipart upload (web admin)
  .post('/:id/documents', async ({ params, request, user, set }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      const docType = formData.get('type')?.toString();

      if (!file || !docType) {
        set.status = 400;
        return { message: 'File and document type are required' };
      }

      const fileObj = file as File;
      const buffer = Buffer.from(await fileObj.arrayBuffer());
      const key = buildUploadKey({
        purpose: 'document',
        contentType: fileObj.type || 'application/octet-stream',
        filename: fileObj.name,
        employeeId: params.id,
        docId: docType,
      });

      await putObject(key, buffer, fileObj.type || 'application/octet-stream');

      const result = await EmployeesService.uploadDocument(
        params.id,
        { name: fileObj.name, size: fileObj.size, type: fileObj.type, key },
        docType,
      );

      set.status = result.status;
      if (!result.ok) return { message: result.message };
      return { message: 'Document uploaded', key };
    } catch (err: any) {
      set.status = 500;
      return { message: err.message || 'Upload failed' };
    }
  }, { ...EmployeeSchemas.UploadDocument, authorize: true as const })

  // GET /api/employees/:id/documents
  .get('/:id/documents', async ({ params, user, set }: any) => {
    if (!user) return unauthorized(set);
    const result = await EmployeesService.getEmployeeDocuments(params.id);
    if (!result.ok) {
      set.status = result.status;
      return { message: result.message };
    }
    return { documents: result.documents, checklist: result.checklist };
  }, { ...EmployeeSchemas.DocumentsList, authorize: true as const })

  // GET /api/employees/:id/document-details
  .get('/:id/document-details', async ({ params, user, set }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    const result = await EmployeesService.getEmployeeDocumentDetails(params.id);
    if (!result.ok) {
      set.status = result.status;
      return { message: result.message };
    }
    return { employee: result.employee, documents: result.documents };
  }, { ...EmployeeSchemas.DocumentDetails, authorize: true as const })

  // DELETE /api/employees/documents/:docId
  .delete('/documents/:docId', async ({ params, user, set }: any) => {
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) throw forbidden();
    const result = await EmployeesService.deleteDocument(params.docId);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Document deleted' };
  }, { ...EmployeeSchemas.DeleteDocument, authorize: true as const })

  // PUT /api/employees/:id/approve
  .put('/:id/approve', async ({ params, user, set }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    const result = await EmployeesService.approveOnboarding(params.id, user.userId);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Onboarding approved' };
  }, { ...EmployeeSchemas.Approve, authorize: true as const })

  // PUT /api/employees/:id/reject
  .put('/:id/reject', async ({ params, body, user, set }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    const result = await EmployeesService.rejectOnboarding(params.id, body.reason);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Onboarding rejected' };
  }, { ...EmployeeSchemas.Reject, authorize: true as const });

function unauthorized(set: any) {
  set.status = 401;
  return { message: 'Unauthorized' };
}
