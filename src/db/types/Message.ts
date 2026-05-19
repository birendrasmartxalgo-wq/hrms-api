import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type MessageType = 'text' | 'file' | 'image' | 'system';

export interface MessageFile {
  fileName?: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
}

export interface MessageReaction {
  emoji?: string;
  by?: ObjectId;
}

export interface MessageDocument {
  _id: ObjectId;
  conversation: ObjectId;
  sender: ObjectId;

  text?: string;
  type?: MessageType;

  file?: MessageFile;
  replyTo?: ObjectId;
  readBy?: ObjectId[];

  reactions?: MessageReaction[];
  mentions?: ObjectId[];

  isPinned?: boolean;
  pinnedBy?: ObjectId;
  pinnedAt?: Date;

  starredBy?: ObjectId[];

  isEdited?: boolean;
  editedAt?: Date;
  isDeleted?: boolean;
  deletedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MessageInsertSchema = z.object({
  conversation: z.any(),
  sender: z.any(),
  text: z.string().default(''),
  type: z.enum(['text', 'file', 'image', 'system']).default('text'),
  file: z.object({
    fileName: z.string().optional(),
    fileUrl: z.string().optional(),
    fileSize: z.number().optional(),
    mimeType: z.string().optional(),
  }).optional(),
  replyTo: z.any().optional(),
  isPinned: z.boolean().default(false),
});

export const MessageUpdateSchema = MessageInsertSchema.partial();
