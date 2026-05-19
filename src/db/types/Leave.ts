import type { ObjectId } from 'mongodb';
import { z } from 'zod';

// Leave Policy
export type LeaveTypeEnum = 'CL' | 'SL' | 'EL' | 'CO' | 'LOP' | 'ML' | 'PL' | 'BL';
export type AccrualTypeEnum = 'upfront' | 'monthly' | 'quarterly';

export interface LeaveTypeDefinition {
  type: LeaveTypeEnum;
  label?: string;
  allowedPerYear?: number;
  accrualType?: AccrualTypeEnum;
  carryForward?: boolean;
  maxCarryForward?: number;
  encashable?: boolean;
  requiresApproval?: boolean;
  minNoticedays?: number;
  maxConsecutiveDays?: number;
  requiresDocument?: boolean;
}

export interface LeavePolicyDocument {
  _id: ObjectId;
  name: string;
  leaveTypes: LeaveTypeDefinition[];
  applicableTo: ObjectId[];
  isDefault?: boolean;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// Leave Balance
export interface LeaveBalanceEntry {
  leaveType?: string;
  allocated?: number;
  used?: number;
  pending?: number;
  balance?: number;
  carriedForward?: number;
}

export interface LeaveBalanceDocument {
  _id: ObjectId;
  employee: ObjectId;
  year: number;
  balances: LeaveBalanceEntry[];
  createdAt?: Date;
  updatedAt?: Date;
}

// Leave Request
export interface LeaveQuestionReply {
  text?: string;
  repliedBy?: ObjectId;
  repliedAt?: Date;
}

export interface LeaveQuestion {
  _id?: ObjectId;
  askedBy: ObjectId;
  askedByRole?: string;
  text: string;
  askedAt?: Date;
  reply?: LeaveQuestionReply;
}

export interface LeaveStatusHistory {
  status?: string;
  changedBy?: ObjectId;
  changedByRole?: string;
  changedAt?: Date;
  remarks?: string;
}

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn';

export interface LeaveRequestDocument {
  _id: ObjectId;
  employee: ObjectId;
  leaveType: LeaveTypeEnum;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  halfDay?: boolean;
  halfDayPeriod?: 'morning' | 'afternoon';
  reason: string;
  attachments?: {
    key?: string;
    url?: string;
    name?: string;
    contentType?: string;
    uploadedAt?: Date;
  }[];
  questions?: LeaveQuestion[];
  status?: LeaveRequestStatus;
  approver?: ObjectId;
  approvedAt?: Date;
  rejectedAt?: Date;
  approverRemarks?: string;
  statusHistory?: LeaveStatusHistory[];
  isLOP?: boolean;
  lopDays?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// Holiday Calendar
export type HolidayType = 'national' | 'regional' | 'optional' | 'restricted';

export interface HolidayDocument {
  _id: ObjectId;
  name: string;
  date: Date;
  type?: HolidayType;
  locations?: string[];
  year: number;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Zod Schemas

export const LeavePolicyInsertSchema = z.object({
  name: z.string().trim().min(1),
  leaveTypes: z.array(z.object({
    type: z.enum(['CL', 'SL', 'EL', 'CO', 'LOP', 'ML', 'PL', 'BL']),
    label: z.string().optional(),
    allowedPerYear: z.number().optional(),
    accrualType: z.enum(['upfront', 'monthly', 'quarterly']).default('upfront'),
    carryForward: z.boolean().default(false),
    maxCarryForward: z.number().optional(),
    encashable: z.boolean().default(false),
    requiresApproval: z.boolean().default(true),
    minNoticedays: z.number().default(0),
    maxConsecutiveDays: z.number().optional(),
    requiresDocument: z.boolean().default(false),
  })).default([]),
  applicableTo: z.array(z.any()).default([]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const LeaveBalanceInsertSchema = z.object({
  employee: z.any(),
  year: z.number(),
  balances: z.array(z.object({
    leaveType: z.string().optional(),
    allocated: z.number().default(0),
    used: z.number().default(0),
    pending: z.number().default(0),
    balance: z.number().default(0),
    carriedForward: z.number().default(0),
  })).default([]),
});

export const LeaveRequestInsertSchema = z.object({
  employee: z.any(),
  leaveType: z.enum(['CL', 'SL', 'EL', 'CO', 'LOP', 'ML', 'PL', 'BL']),
  startDate: z.date(),
  endDate: z.date(),
  totalDays: z.number(),
  halfDay: z.boolean().default(false),
  halfDayPeriod: z.enum(['morning', 'afternoon']).optional(),
  reason: z.string().trim().min(1),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'withdrawn']).default('pending'),
  isLOP: z.boolean().default(false),
  lopDays: z.number().default(0),
});

export const HolidayInsertSchema = z.object({
  name: z.string().trim().min(1),
  date: z.date(),
  type: z.enum(['national', 'regional', 'optional', 'restricted']).default('national'),
  locations: z.array(z.string()).default([]),
  year: z.number(),
  description: z.string().optional(),
});
