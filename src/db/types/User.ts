import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type UserRole = 'admin' | 'hr' | 'employee';

export interface UserDocument {
  _id: ObjectId;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  employee?: ObjectId;
  isActive?: boolean;
  forcedLogoutAt?: Date | null;
  lockedUntil?: Date | null;
  
  // Password reset (OTP flow)
  passwordResetOtpHash?: string | null;
  passwordResetOtpExpires?: Date | null;
  passwordResetAttempts?: number;
  passwordResetTokenHash?: string | null;
  passwordResetTokenExpires?: Date | null;
  otpRequestCount?: number;
  otpLastRequestedAt?: Date | null;

  // Push notification tokens (one per active device, keyed by platform+device)
  pushTokens?: Array<{
    token: string;
    platform: 'ios' | 'android' | 'web';
    updatedAt: Date;
  }>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserInsertSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1),
  name: z.string().trim().min(1),
  role: z.enum(['admin', 'hr', 'employee']).default('employee'),
  employee: z.any().optional(), // ObjectId handled separately if passed
  isActive: z.boolean().default(true),
  forcedLogoutAt: z.date().nullable().optional(),
});

export const UserUpdateSchema = UserInsertSchema.partial();
