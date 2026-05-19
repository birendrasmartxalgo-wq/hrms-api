import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type DocumentType = 'aadhar' | 'pan' | 'bank_details' | 'relieving_letter' | 'police_verification' | 'qualification_cert' | 'nda' | 'offer_letter' | 'joining_letter';

export interface DocumentRecordDocument {
  _id: ObjectId;
  employee: ObjectId;
  type: DocumentType;
  label?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  isVerified?: boolean;
  verifiedBy?: ObjectId;
  verifiedAt?: Date;
  remarks?: string;
  isRequired?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DocumentInsertSchema = z.object({
  employee: z.any(),
  type: z.enum(['aadhar', 'pan', 'bank_details', 'relieving_letter', 'police_verification', 'qualification_cert', 'nda', 'offer_letter', 'joining_letter']),
  label: z.string().optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  mimeType: z.string().optional(),
  isVerified: z.boolean().default(false),
  isRequired: z.boolean().default(true),
});

export const DocumentUpdateSchema = DocumentInsertSchema.partial();
