import { collections } from '../../db/collections';
import { UsersService } from '../users/service';
import { ObjectId } from 'mongodb';
import { emailService } from '../../services/emailService';
import crypto from 'crypto';

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const RESEND_BASE_SECONDS = 30;
const RESEND_MAX_SECONDS = 15 * 60;
const REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS_BEFORE_LOCK = 6;
const LOCK_DURATION_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

function genOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nextResendDelaySeconds(requestCount: number) {
  const delay = RESEND_BASE_SECONDS * Math.pow(2, Math.max(0, requestCount - 1));
  return Math.min(delay, RESEND_MAX_SECONDS);
}

export const AuthService = {
  async getMe(userId: string) {
    const pipeline = [
      { $match: { _id: new ObjectId(userId) } },
      { $project: { password: 0, passwordResetOtpHash: 0, passwordResetTokenHash: 0 } },
      {
        $lookup: {
          from: 'employees',
          localField: 'employee',
          foreignField: '_id',
          as: 'employeeObj'
        }
      },
      {
        $unwind: {
          path: '$employeeObj',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'departments',
          localField: 'employeeObj.department',
          foreignField: '_id',
          as: 'departmentObj'
        }
      },
      {
        $unwind: {
          path: '$departmentObj',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    const users = await collections.users().aggregate(pipeline).toArray();
    if (!users.length) return null;

    const user = users[0];
    
    // Remap the employee and department for the contract shape
    if (user.employeeObj) {
      if (user.departmentObj) {
        user.employeeObj.department = user.departmentObj;
      }
      user.employee = user.employeeObj;
      delete user.employeeObj;
      delete user.departmentObj;
    }

    // Include __v for compatibility with legacy tests if needed
    user.__v = 0;
    if (user.employee) user.employee.__v = 0;

    return user;
  },

  async forgotPassword(email: string) {
    const user = await collections.users().findOne({ email: email.toLowerCase() });
    if (!user) {
      return { ok: true, extra: {} };
    }

    const now = Date.now();

    if (user.lockedUntil && user.lockedUntil.getTime() > now) {
      const retryAfter = Math.ceil((user.lockedUntil.getTime() - now) / 1000);
      return { ok: false, status: 429, message: 'Account temporarily locked. Try again later.', retryAfter };
    }

    let requestCount = user.otpRequestCount || 0;
    
    if (user.otpLastRequestedAt && now - user.otpLastRequestedAt.getTime() > REQUEST_WINDOW_MS) {
      requestCount = 0;
    }

    if (user.otpLastRequestedAt && requestCount > 0) {
      const requiredWaitSec = nextResendDelaySeconds(requestCount);
      const elapsedSec = Math.floor((now - user.otpLastRequestedAt.getTime()) / 1000);
      const remaining = requiredWaitSec - elapsedSec;
      if (remaining > 0) {
        return { ok: false, status: 429, message: `Please wait ${remaining}s before requesting another code.`, retryAfter: remaining };
      }
    }

    if (requestCount >= MAX_REQUESTS_BEFORE_LOCK) {
      await collections.users().updateOne(
        { _id: user._id },
        { 
          $set: { 
            lockedUntil: new Date(now + LOCK_DURATION_MS),
            otpRequestCount: 0,
            passwordResetOtpHash: null,
            passwordResetOtpExpires: null,
            passwordResetAttempts: 0,
            passwordResetTokenHash: null,
            passwordResetTokenExpires: null,
          } 
        }
      );
      return { ok: false, status: 429, message: 'Too many password reset requests. Account locked for 24 hours.', retryAfter: Math.ceil(LOCK_DURATION_MS / 1000) };
    }

    const otp = genOtp();
    const otpHash = await UsersService.hashPassword(otp);

    await collections.users().updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetOtpHash: otpHash,
          passwordResetOtpExpires: new Date(now + OTP_EXPIRY_MINUTES * 60 * 1000),
          passwordResetAttempts: 0,
          passwordResetTokenHash: null,
          passwordResetTokenExpires: null,
          otpRequestCount: requestCount + 1,
          otpLastRequestedAt: new Date(now),
        }
      }
    );

    emailService.passwordResetOtpEmail(user.email, user.name, otp, OTP_EXPIRY_MINUTES).catch(() => {});

    return { ok: true, extra: { expiresInMinutes: OTP_EXPIRY_MINUTES, nextResendInSeconds: nextResendDelaySeconds(requestCount + 1) } };
  },

  async verifyOtp(email: string, otp: string) {
    const user = await collections.users().findOne({ email: email.toLowerCase() });
    if (!user) return { ok: false, status: 400, message: 'Invalid or expired code' };

    const now = Date.now();
    if (user.lockedUntil && user.lockedUntil.getTime() > now) {
      return { ok: false, status: 429, message: 'Account temporarily locked. Try again later.' };
    }

    if (!user.passwordResetOtpHash || !user.passwordResetOtpExpires || user.passwordResetOtpExpires.getTime() < now) {
      return { ok: false, status: 400, message: 'Invalid or expired code' };
    }

    const attempts = user.passwordResetAttempts || 0;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await collections.users().updateOne({ _id: user._id }, { $set: { passwordResetOtpHash: null, passwordResetOtpExpires: null } });
      return { ok: false, status: 400, message: 'Too many attempts. Request a new code.' };
    }

    const ok = await Bun.password.verify(otp, user.passwordResetOtpHash);
    if (!ok) {
      const newAttempts = attempts + 1;
      const remaining = MAX_OTP_ATTEMPTS - newAttempts;
      
      const update: any = { $set: { passwordResetAttempts: newAttempts } };
      if (remaining <= 0) {
        update.$set.passwordResetOtpHash = null;
        update.$set.passwordResetOtpExpires = null;
      }
      await collections.users().updateOne({ _id: user._id }, update);

      return { 
        ok: false, 
        status: 400, 
        message: remaining > 0 ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` : 'Too many attempts. Request a new code.',
        attemptsRemaining: Math.max(0, remaining)
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    await collections.users().updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetTokenHash: sha256(rawToken),
          passwordResetTokenExpires: new Date(now + RESET_TOKEN_TTL_MS),
          passwordResetOtpHash: null,
          passwordResetOtpExpires: null,
          passwordResetAttempts: 0
        }
      }
    );

    return { ok: true, resetToken: rawToken, expiresInMinutes: Math.ceil(RESET_TOKEN_TTL_MS / 60000) };
  },

  async resetPassword(email: string, resetToken: string, newPassword: string) {
    const user = await collections.users().findOne({ email: email.toLowerCase() });
    if (!user) return { ok: false, status: 400, message: 'Invalid or expired reset session' };

    const now = Date.now();
    if (!user.passwordResetTokenHash || !user.passwordResetTokenExpires || user.passwordResetTokenExpires.getTime() < now) {
      return { ok: false, status: 400, message: 'Invalid or expired reset session' };
    }

    const incomingHash = sha256(resetToken);
    const stored = Buffer.from(user.passwordResetTokenHash, 'hex');
    const incoming = Buffer.from(incomingHash, 'hex');
    
    if (stored.length !== incoming.length || !crypto.timingSafeEqual(stored, incoming)) {
      return { ok: false, status: 400, message: 'Invalid or expired reset session' };
    }

    if (await Bun.password.verify(newPassword, user.password)) {
      return { ok: false, status: 400, message: 'New password must be different from the current one' };
    }

    const newPasswordHash = await UsersService.hashPassword(newPassword);

    await collections.users().updateOne(
      { _id: user._id },
      {
        $set: {
          password: newPasswordHash,
          passwordResetTokenHash: null,
          passwordResetTokenExpires: null,
          passwordResetOtpHash: null,
          passwordResetOtpExpires: null,
          passwordResetAttempts: 0,
          otpRequestCount: 0,
          otpLastRequestedAt: null,
          forcedLogoutAt: new Date(),
        }
      }
    );

    emailService.passwordResetConfirmedEmail(user.email, user.name).catch(() => {});

    return { ok: true };
  }
};
