import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type SalarySlipStatus = 'draft' | 'finalized';

export interface SalarySlipDocument {
  _id: ObjectId;
  employee: ObjectId;
  month: number;
  year: number;
  periodFrom: Date;
  periodTo: Date;

  workingDays?: number;
  presentDays?: number;
  leaveDays?: number;
  lopDays?: number;

  monthlyCTC?: number;
  basic?: number;
  hra?: number;
  da?: number;
  specialAllowance?: number;
  employerEPF?: number;
  employeeEPF?: number;
  lopDeduction?: number;
  lateCount?: number;
  lateLopDays?: number;
  lateDeduction?: number;
  grossEarnings?: number;
  totalDeductions?: number;
  netTakeHome?: number;
  netPay?: number;
  tds?: number;
  professionalTax?: number;
  enableEPF?: boolean;
  enableESI?: boolean;

  paymentDate?: Date;

  bankAccountName?: string;
  bankAccountNo?: string;
  bankName?: string;
  bankAddress?: string;
  ifscCode?: string;
  epfNo?: string;
  esiNo?: string;

  status?: SalarySlipStatus;
  finalizedBy?: ObjectId;
  finalizedAt?: Date;
  remarks?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SalarySlipInsertSchema = z.object({
  employee: z.any(),
  month: z.number().min(1).max(12),
  year: z.number(),
  periodFrom: z.date(),
  periodTo: z.date(),
  workingDays: z.number().default(0),
  presentDays: z.number().default(0),
  leaveDays: z.number().default(0),
  lopDays: z.number().default(0),
  monthlyCTC: z.number().default(0),
  basic: z.number().default(0),
  hra: z.number().default(0),
  da: z.number().default(0),
  specialAllowance: z.number().default(0),
  employerEPF: z.number().default(0),
  employeeEPF: z.number().default(0),
  lopDeduction: z.number().default(0),
  lateCount: z.number().default(0),
  lateLopDays: z.number().default(0),
  lateDeduction: z.number().default(0),
  grossEarnings: z.number().default(0),
  totalDeductions: z.number().default(0),
  netTakeHome: z.number().default(0),
  netPay: z.number().default(0),
  tds: z.number().default(0),
  professionalTax: z.number().default(0),
  enableEPF: z.boolean().default(false),
  enableESI: z.boolean().default(false),
  paymentDate: z.date().optional(),
  status: z.enum(['draft', 'finalized']).default('draft'),
});

export const SalarySlipUpdateSchema = SalarySlipInsertSchema.partial();
