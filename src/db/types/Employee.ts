import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type EmploymentStatus = 'active' | 'inactive' | 'former';
export type SeparationType = 'resigned' | 'terminated' | 'retired' | 'contract_ended' | 'other' | '';
export type OnboardingStatus = 'pending_documents' | 'pending_approval' | 'approved' | 'rejected';
export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | '';

export interface Separation {
  dateOfLeave?: Date | null;
  reason?: string;
  separationType?: SeparationType;
  recordedBy?: ObjectId | null;
  recordedAt?: Date | null;
}

export interface EmployeeDocument {
  _id: ObjectId;
  user?: ObjectId;
  empId: string;
  name: string;
  department?: ObjectId;
  designation?: string;
  dateOfJoining?: Date;
  reportingManager?: ObjectId;
  isActive?: boolean;
  employmentStatus?: EmploymentStatus;
  separation?: Separation;
  deletedAt?: Date | null;
  deletedBy?: ObjectId | null;
  onboardingStatus?: OnboardingStatus;
  onboardingApprovedBy?: ObjectId;
  onboardingApprovedAt?: Date;
  onboardingRejectionReason?: string;
  phone?: string;
  emergencyContact?: string;
  address?: string;
  dateOfBirth?: Date;
  bloodGroup?: BloodGroup;
  personalEmail?: string;
  linkedIn?: string;
  bio?: string;
  avatar?: string;
  canMarkAttendance?: boolean;

  // Payroll
  annualCTC?: number;
  basicPercent?: number;
  daAmount?: number;
  specialAllowance?: number;
  enableEPF?: boolean;
  enableESI?: boolean;
  bankAccountName?: string;
  bankAccountNo?: string;
  bankName?: string;
  bankAddress?: string;
  ifscCode?: string;
  epfNo?: string;
  esiNo?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EmployeeInsertSchema = z.object({
  user: z.any().optional(),
  empId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  department: z.any().optional(),
  designation: z.string().trim().optional(),
  dateOfJoining: z.date().default(() => new Date()),
  reportingManager: z.any().optional(),
  isActive: z.boolean().default(true),
  employmentStatus: z.enum(['active', 'inactive', 'former']).default('active'),
  separation: z.object({
    dateOfLeave: z.date().nullable().optional(),
    reason: z.string().trim().max(500).optional(),
    separationType: z.enum(['resigned', 'terminated', 'retired', 'contract_ended', 'other', '']).optional(),
    recordedBy: z.any().nullable().optional(),
    recordedAt: z.date().nullable().optional(),
  }).optional(),
  onboardingStatus: z.enum(['pending_documents', 'pending_approval', 'approved', 'rejected']).default('pending_documents'),
  phone: z.string().trim().optional(),
  emergencyContact: z.string().trim().optional(),
  address: z.string().trim().optional(),
  dateOfBirth: z.date().optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', '']).optional(),
  personalEmail: z.string().trim().optional(),
  linkedIn: z.string().trim().optional(),
  bio: z.string().trim().max(500).optional(),
  avatar: z.string().optional(),
  canMarkAttendance: z.boolean().default(true),
  annualCTC: z.number().min(0).max(99999999).default(0),
  basicPercent: z.number().min(1).max(80).default(50),
  daAmount: z.number().min(0).max(99999999).default(0),
  specialAllowance: z.number().min(0).max(99999999).default(0),
  enableEPF: z.boolean().default(false),
  enableESI: z.boolean().default(false),
  bankAccountName: z.string().trim().max(100).optional(),
  bankAccountNo: z.string().trim().optional(),
  bankName: z.string().trim().max(100).optional(),
  bankAddress: z.string().trim().max(200).optional(),
  ifscCode: z.string().trim().optional(),
  epfNo: z.string().trim().optional(),
  esiNo: z.string().trim().optional(),
});

export const EmployeeUpdateSchema = EmployeeInsertSchema.partial();
