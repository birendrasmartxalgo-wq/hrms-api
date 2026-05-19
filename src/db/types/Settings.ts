import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export interface SettingsDocument {
  _id: ObjectId;
  key: string;
  value: any;
  updatedBy?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SettingsInsertSchema = z.object({
  key: z.string().trim().min(1),
  value: z.any(),
  updatedBy: z.any().optional(),
});

export const SettingsUpdateSchema = SettingsInsertSchema.partial();
