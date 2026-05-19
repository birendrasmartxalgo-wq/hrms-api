import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type RepunchRequestStatus = 'pending' | 'approved' | 'rejected';

export interface LocationSnapshot {
  lat?: number;
  lng?: number;
  accuracy?: number;
  ip?: string;
}

export interface RepunchRequestDocument {
  _id: ObjectId;
  employee: ObjectId;
  attendance: ObjectId;
  date: Date;

  location?: LocationSnapshot;
  selfieUrl?: string;

  status?: RepunchRequestStatus;
  requestedAt?: Date;

  approvedBy?: ObjectId;
  approvedAt?: Date;
  rejectedBy?: ObjectId;
  rejectedAt?: Date;
  adminRemarks?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const RepunchRequestInsertSchema = z.object({
  employee: z.any(),
  attendance: z.any(),
  date: z.date(),
  location: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    accuracy: z.number().optional(),
    ip: z.string().optional(),
  }).optional(),
  selfieUrl: z.string().default('no-selfie'),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  requestedAt: z.date().default(() => new Date()),
});

export const RepunchRequestUpdateSchema = RepunchRequestInsertSchema.partial();
