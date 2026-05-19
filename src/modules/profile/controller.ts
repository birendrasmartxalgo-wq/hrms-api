import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import { ProfileSchemas } from './schema';
import { ProfileService } from './service';
import { authPlugin } from '../../plugins/auth';
import { buildUploadKey, putObject } from '../../services/s3';
import { forbidden } from '../../errors';
import { collections } from '../../db/collections';

export const profileController = new Elysia({ prefix: '/profile' })
  .use(authPlugin)

  // GET /api/profile/me
  .get('/me', async ({ user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const profile = await ProfileService.getMyProfile(user.userId);
    if (!profile) {
      set.status = 404;
      return { message: 'Profile not found' };
    }
    return { user: profile };
  }, { authorize: true as const })

  // PUT /api/profile/me
  .put('/me', async ({ body, user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const result = await ProfileService.updateMyProfile(user.userId, body);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Profile updated' };
  }, { ...ProfileSchemas.UpdateMe, authorize: true as const })

  // PUT /api/profile/change-password
  .put('/change-password', async ({ body, user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const result = await ProfileService.changePassword(user.userId, body.currentPassword, body.newPassword);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Password changed' };
  }, { ...ProfileSchemas.ChangePassword, authorize: true as const })

  // POST /api/profile/avatar - multipart upload
  .post('/avatar', async ({ request, user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    try {
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file) {
        set.status = 400;
        return { message: 'Avatar file is required' };
      }

      const fileObj = file as File;
      const buffer = Buffer.from(await fileObj.arrayBuffer());
      const key = buildUploadKey({
        purpose: 'avatar',
        contentType: fileObj.type || 'image/jpeg',
        filename: fileObj.name,
        employeeId: user.employeeId || user.userId,
      });

      await putObject(key, buffer, fileObj.type || 'image/jpeg');

      const result = await ProfileService.uploadAvatar(user.userId, {
        name: fileObj.name,
        size: fileObj.size,
        type: fileObj.type,
        key,
      });

      set.status = result.status;
      if (!result.ok) return { message: result.message };
      return { message: 'Avatar uploaded', avatar: key };
    } catch (err: any) {
      set.status = 500;
      return { message: err.message || 'Upload failed' };
    }
  }, { authorize: true as const })

  // POST /api/profile/documents - multipart upload
  .post('/documents', async ({ request, user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
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
        employeeId: user.employeeId || user.userId,
        docId: docType,
      });

      await putObject(key, buffer, fileObj.type || 'application/octet-stream');

      const result = await ProfileService.uploadSelfDocument(
        user.userId,
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
  }, { authorize: true as const })

  // GET /api/profile/documents
  .get('/documents', async ({ user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const result = await ProfileService.getMyDocuments(user.userId);
    if (!result.ok) {
      set.status = result.status;
      return { message: result.message };
    }
    return { documents: result.documents, checklist: result.checklist };
  }, { authorize: true as const })

  // POST /api/profile/push-token — register / refresh an Expo push token for this user+device
  .post('/push-token', async ({ user, body, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const { token, platform } = body as { token: string; platform: 'ios' | 'android' | 'web' };
    const userId = new ObjectId(user.userId);

    // Pull any existing entry for this token (across users) so a re-installed device
    // doesn't keep firing notifications at the previous owner.
    await collections.users().updateMany(
      { 'pushTokens.token': token },
      { $pull: { pushTokens: { token } } as any },
    );

    await collections.users().updateOne(
      { _id: userId },
      {
        $push: {
          pushTokens: { token, platform, updatedAt: new Date() } as any,
        } as any,
      },
    );

    return { ok: true };
  }, {
    authorize: true as const,
    body: t.Object({
      token: t.String({ minLength: 1 }),
      platform: t.Union([t.Literal('ios'), t.Literal('android'), t.Literal('web')]),
    }),
  })

  // DELETE /api/profile/push-token — remove on logout
  .delete('/push-token', async ({ user, body, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const { token } = body as { token: string };
    await collections.users().updateOne(
      { _id: new ObjectId(user.userId) },
      { $pull: { pushTokens: { token } } as any },
    );
    return { ok: true };
  }, {
    authorize: true as const,
    body: t.Object({ token: t.String({ minLength: 1 }) }),
  })

  // PUT /api/profile/admin/change-password/:userId
  .put('/admin/change-password/:userId', async ({ params, body, user, set }: any) => {
    if (!user || user.role !== 'admin') throw forbidden();
    const result = await ProfileService.adminChangePassword(user.userId, params.userId, body.newPassword);
    set.status = result.status;
    if (!result.ok) return { message: result.message };
    return { message: 'Password changed' };
  }, { ...ProfileSchemas.AdminChangePassword, authorize: true as const })

  // GET /api/profile/:empId
  .get('/:empId', async ({ params, user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    const profile = await ProfileService.getEmployeeProfile(params.empId);
    if (!profile) {
      set.status = 404;
      return { message: 'Employee not found' };
    }
    return { employee: profile };
  }, { ...ProfileSchemas.Employee, authorize: true as const });
