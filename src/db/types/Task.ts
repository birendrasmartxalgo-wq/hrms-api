import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type TaskRecurrence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'none';

export interface TaskSubtask {
  title: string;
  completed?: boolean;
  completedAt?: Date;
  assignee?: ObjectId;
}

export interface TaskComment {
  author: ObjectId;
  text: string;
  createdAt?: Date;
  editedAt?: Date;
}

export interface TaskTimeEntry {
  employee?: ObjectId;
  hours?: number;
  description?: string;
  date?: Date;
}

export interface TaskAttachment {
  fileName?: string;
  fileUrl?: string;
  fileSize?: number;
  uploadedBy?: ObjectId;
  uploadedAt?: Date;
}

export interface TaskActivityLog {
  action?: string;
  performedBy?: ObjectId;
  description?: string;
  meta?: any;
  at?: Date;
}

export interface TaskDocument {
  _id: ObjectId;
  title: string;
  description?: string;

  createdBy: ObjectId;
  assignee?: ObjectId;
  watchers?: ObjectId[];

  project?: string;
  tags?: string[];

  status?: TaskStatus;
  priority?: TaskPriority;

  dueDate?: Date;
  startDate?: Date;
  completedAt?: Date;

  subtasks?: TaskSubtask[];
  comments?: TaskComment[];

  estimatedHours?: number;
  loggedHours?: number;
  timeEntries?: TaskTimeEntry[];

  attachments?: TaskAttachment[];

  parentTask?: ObjectId;
  dependencies?: ObjectId[];

  isRecurring?: boolean;
  recurringPattern?: TaskRecurrence;

  progress?: number;

  activityLog?: TaskActivityLog[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const TaskInsertSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().default(''),
  createdBy: z.any(),
  assignee: z.any().optional(),
  watchers: z.array(z.any()).default([]),
  project: z.string().trim().optional(),
  tags: z.array(z.string().trim()).default([]),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).default('todo'),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).default('medium'),
  dueDate: z.date().optional(),
  startDate: z.date().optional(),
  estimatedHours: z.number().optional(),
  loggedHours: z.number().default(0),
  isRecurring: z.boolean().default(false),
  recurringPattern: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'none']).default('none'),
  progress: z.number().min(0).max(100).default(0),
});

export const TaskUpdateSchema = TaskInsertSchema.partial();
