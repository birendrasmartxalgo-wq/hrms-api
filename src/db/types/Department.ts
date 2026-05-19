import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export interface DepartmentDocument {
  _id: ObjectId;
  name: string;
  code: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DepartmentInsertSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1).toUpperCase(),
  isActive: z.boolean().default(true),
});

export const DepartmentUpdateSchema = DepartmentInsertSchema.partial();
