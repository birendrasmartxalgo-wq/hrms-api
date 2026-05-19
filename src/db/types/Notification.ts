import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type NotificationType = 'task' | 'leave' | 'chat' | 'announcement' | 'info';

export interface NotificationDocument {
  _id: ObjectId;
  employee: ObjectId;
  title: string;
  body?: string;
  type?: NotificationType;
  link?: string | null;
  read?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const NotificationInsertSchema = z.object({
  employee: z.any(),
  title: z.string().min(1),
  body: z.string().default(''),
  type: z.enum(['task', 'leave', 'chat', 'announcement', 'info']).default('info'),
  link: z.string().nullable().default(null),
  read: z.boolean().default(false),
});

export const NotificationUpdateSchema = NotificationInsertSchema.partial();
