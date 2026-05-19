import { Elysia } from 'elysia';
import { AuthSchemas } from './schema';
import { AuthService } from './service';
import { collections } from '../../db/collections';
import { UsersService } from '../users/service';
import { authPlugin } from '../../plugins/auth';
import { ObjectId } from 'mongodb';
import { env } from '../../env';
import jwt from 'jsonwebtoken';

function signToken(userId: string, role: string, employeeId?: string) {
  return jwt.sign({ id: userId, role, employeeId }, env.JWT_SECRET, { expiresIn: '24h' });
}

function signRefreshToken(userId: string, role: string, client: string) {
  const expiresIn = client === 'mobile' ? '30d' : '7d';
  return jwt.sign({ id: userId, role, client }, env.JWT_REFRESH_SECRET, { expiresIn });
}

export const authController = new Elysia({ prefix: '/auth' })
  .use(authPlugin)

  .post('/register', async ({ body, set }) => {
    const { email, password, name, role, empId, department, designation } = body;

    const existingUser = await collections.users().findOne({ email: email.toLowerCase() });
    if (existingUser) {
      set.status = 400;
      return { message: 'Email already registered' };
    }

    const safeRole = 'employee';
    
    // Hash password via UsersService
    const hashedPassword = await UsersService.hashPassword(password);
    
    const userResult = await collections.users().insertOne({
      _id: new ObjectId(),
      email: email.toLowerCase(),
      password: hashedPassword,
      name,
      role: safeRole,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    let deptId = null;
    if (department) {
      let deptQuery: any = { name: department };
      if (ObjectId.isValid(department)) {
        deptQuery = { $or: [{ _id: new ObjectId(department) }, { code: department }, { name: department }] };
      }
      const dept = await collections.departments().findOne(deptQuery);
      if (dept) deptId = dept._id;
    }

    const empIdStr = empId || `EMP${Date.now().toString().slice(-6)}`;
    
    const employeeResult = await collections.employees().insertOne({
      _id: new ObjectId(),
      user: userResult.insertedId,
      empId: empIdStr,
      name,
      department: deptId,
      designation: designation || 'Employee',
      employmentStatus: 'active',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await collections.users().updateOne(
      { _id: userResult.insertedId },
      { $set: { employee: employeeResult.insertedId } }
    );

    const token = signToken(userResult.insertedId.toString(), safeRole, employeeResult.insertedId.toString());
    const refreshToken = signRefreshToken(userResult.insertedId.toString(), safeRole, 'web');

    set.status = 201;
    return {
      message: 'Registration successful',
      token,
      refreshToken,
      user: {
        _id: userResult.insertedId.toString(),
        email: email.toLowerCase(),
        name,
        role: safeRole,
        employee: employeeResult.insertedId.toString(),
      }
    };
  }, AuthSchemas.Register)

  .post('/login', async ({ body, query, set }) => {
    const { email, password } = body;
    const client = query.client === 'mobile' ? 'mobile' : 'web';

    const user = await collections.users().findOne({ email: email.toLowerCase() });
    if (!user || !user.isActive) {
      set.status = 401;
      return { message: 'Invalid credentials' };
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      set.status = 423;
      return { message: 'Account temporarily locked. Try again later.', retryAfter };
    }

    const isMatch = await UsersService.verifyPassword(user, password);
    if (!isMatch) {
      set.status = 401;
      return { message: 'Invalid credentials' };
    }

    const token = signToken(user._id.toString(), user.role, user.employee?.toString());
    const refreshToken = signRefreshToken(user._id.toString(), user.role, client);

    return {
      token,
      refreshToken,
      user: {
        _id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        employee: user.employee?.toString()
      }
    };
  }, AuthSchemas.Login)

  .post('/refresh', async ({ body, set }) => {
    const { refreshToken } = body;

    try {
      const decoded: any = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
      const user = await collections.users().findOne({ _id: new ObjectId(decoded.id) });
      
      if (!user || !user.isActive) {
        set.status = 401;
        return { message: 'Invalid refresh token' };
      }

      const token = signToken(user._id.toString(), user.role, user.employee?.toString());
      return { token };
    } catch (err) {
      set.status = 401;
      return { message: 'Invalid refresh token' };
    }
  }, AuthSchemas.Refresh)

  .post('/forgot-password', async ({ body, set }) => {
    const result = await AuthService.forgotPassword(body.email);
    if (!result.ok) {
      set.status = result.status || 500;
      return { message: result.message, retryAfter: result.retryAfter };
    }

    return {
      message: 'If an account with that email exists, an OTP has been sent.',
      ...result.extra
    };
  }, AuthSchemas.ForgotPassword)

  .post('/verify-otp', async ({ body, set }) => {
    const result = await AuthService.verifyOtp(body.email, body.otp);
    if (!result.ok) {
      set.status = result.status || 500;
      return { 
        message: result.message, 
        attemptsRemaining: result.attemptsRemaining 
      };
    }

    return {
      message: 'Code verified',
      resetToken: result.resetToken,
      expiresInMinutes: result.expiresInMinutes
    };
  }, AuthSchemas.VerifyOtp)

  .post('/reset-password', async ({ body, set }) => {
    if (body.newPassword !== body.confirmPassword) {
      set.status = 400;
      return { message: 'Passwords do not match' };
    }
    if (body.newPassword.length < 8) {
      set.status = 400;
      return { message: 'Password must be at least 8 characters' };
    }

    const result = await AuthService.resetPassword(body.email, body.resetToken, body.newPassword);
    if (!result.ok) {
      set.status = result.status || 500;
      return { message: result.message };
    }

    return { message: 'Password updated. Please sign in with your new password.' };
  }, AuthSchemas.ResetPassword)

  // Protected Routes
  .get('/me', async ({ user, set }: any) => {
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    
    const fullUser = await AuthService.getMe(user.userId);
    if (!fullUser) {
      set.status = 404;
      return { message: 'User not found' };
    }
    
    return { user: fullUser };
  }, { authorize: true as const });
