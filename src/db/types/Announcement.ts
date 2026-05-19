import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type AnnouncementPriority = 'normal' | 'important' | 'urgent';

export interface AnnouncementDocument {
  _id: ObjectId;
  title: string;
  body: string;
  postedBy: ObjectId;
  targetAll?: boolean;
  department?: ObjectId | null;
  priority?: AnnouncementPriority;
  createdAt?: Date;
  updatedAt?: Date;
}

export const AnnouncementInsertSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  postedBy: z.any(),
  targetAll: z.boolean().default(true),
  department: z.any().nullable().default(null),
  priority: z.enum(['normal', 'important', 'urgent']).default('normal'),
});

export const AnnouncementUpdateSchema = AnnouncementInsertSchema.partial();
