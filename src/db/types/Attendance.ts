import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export interface Location {
  lat: number;
  lng: number;
  accuracy?: number;
  address?: string;
  ip?: string;
}

export interface PunchEvent {
  time: Date;
  location: Location;
  selfieUrl?: string;
  selfiePublicId?: string;
  withinGeofence?: boolean;
  distanceFromOffice?: number;
}

export type BreakType = 'lunch' | 'tea' | 'personal' | 'other';

export interface BreakEvent {
  startTime: Date;
  startLocation?: Location;
  endTime?: Date;
  endLocation?: Location;
  durationMinutes?: number;
  type?: BreakType;
}

export type AttendanceStatus = 'absent' | 'present' | 'half_day' | 'work_from_home' | 'on_leave' | 'holiday' | 'weekend';
export type AttendanceSource = 'web' | 'mobile' | 'biometric' | 'regularized' | 'auto';

export interface AttendanceDocument {
  _id: ObjectId;
  employee: ObjectId;
  date: Date;

  punchIn?: PunchEvent;
  punchOut?: PunchEvent;
  breaks?: BreakEvent[];

  totalWorkingMinutes?: number;
  totalBreakMinutes?: number;
  netWorkingMinutes?: number;

  status?: AttendanceStatus;

  isLate?: boolean;
  isEarlyLeave?: boolean;
  isOvertime?: boolean;

  isRegularized?: boolean;
  regularizedBy?: ObjectId;
  regularizationReason?: string;
  regularizedAt?: Date;

  remarks?: string;
  source?: AttendanceSource;

  createdAt?: Date;
  updatedAt?: Date;
}

const LocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
  address: z.string().optional(),
  ip: z.string().optional(),
});

const PunchEventSchema = z.object({
  time: z.date(),
  location: LocationSchema,
  selfieUrl: z.string().optional(),
  selfiePublicId: z.string().optional(),
  withinGeofence: z.boolean().default(false),
  distanceFromOffice: z.number().optional(),
});

const BreakEventSchema = z.object({
  startTime: z.date(),
  startLocation: LocationSchema.optional(),
  endTime: z.date().optional(),
  endLocation: LocationSchema.optional(),
  durationMinutes: z.number().optional(),
  type: z.enum(['lunch', 'tea', 'personal', 'other']).default('other'),
});

export const AttendanceInsertSchema = z.object({
  employee: z.any(),
  date: z.date(),
  punchIn: PunchEventSchema.optional(),
  punchOut: PunchEventSchema.optional(),
  breaks: z.array(BreakEventSchema).optional(),
  totalWorkingMinutes: z.number().default(0),
  totalBreakMinutes: z.number().default(0),
  netWorkingMinutes: z.number().default(0),
  status: z.enum(['absent', 'present', 'half_day', 'work_from_home', 'on_leave', 'holiday', 'weekend']).default('absent'),
  isLate: z.boolean().default(false),
  isEarlyLeave: z.boolean().default(false),
  isOvertime: z.boolean().default(false),
  isRegularized: z.boolean().default(false),
  regularizationReason: z.string().optional(),
  remarks: z.string().optional(),
  source: z.enum(['web', 'mobile', 'biometric', 'regularized', 'auto']).default('web'),
});

export const AttendanceUpdateSchema = AttendanceInsertSchema.partial();
