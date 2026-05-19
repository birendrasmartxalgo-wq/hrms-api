import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export interface SalaryRevisionDocument {
  _id: ObjectId;
  employee: ObjectId;
  version: number;
  annualCTC: number;
  basicPercent?: number;
  daAmount?: number;
  enableEPF?: boolean;
  enableESI?: boolean;
  effectiveFrom: Date;
  createdBy?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SalaryRevisionInsertSchema = z.object({
  employee: z.any(),
  version: z.number(),
  annualCTC: z.number().min(0).max(99999999),
  basicPercent: z.number().min(1).max(80).default(50),
  daAmount: z.number().min(0).max(99999999).default(0),
  enableEPF: z.boolean().default(false),
  enableESI: z.boolean().default(false),
  effectiveFrom: z.date(),
  createdBy: z.any().optional(),
});

export const SalaryRevisionUpdateSchema = SalaryRevisionInsertSchema.partial();
