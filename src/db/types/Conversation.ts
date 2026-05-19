import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export type ConversationType = 'direct' | 'group';

export interface ConversationLastMessage {
  text?: string;
  sender?: ObjectId;
  timestamp?: Date;
  type?: 'text' | 'file' | 'image' | 'system';
}

export interface ConversationReadReceipt {
  participant?: ObjectId;
  lastReadAt?: Date;
}

export interface ConversationDocument {
  _id: ObjectId;
  type: ConversationType;

  // direct
  participants?: ObjectId[];

  // group
  name?: string;
  description?: string;
  avatar?: string;
  admin?: ObjectId;

  lastMessage?: ConversationLastMessage;
  readBy?: ConversationReadReceipt[];

  isPinned?: ObjectId[];
  isMuted?: ObjectId[];

  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ConversationInsertSchema = z.object({
  type: z.enum(['direct', 'group']),
  participants: z.array(z.any()).optional(),
  name: z.string().trim().optional(),
  description: z.string().optional(),
  avatar: z.string().optional(),
  admin: z.any().optional(),
  isActive: z.boolean().default(true),
});

export const ConversationUpdateSchema = ConversationInsertSchema.partial();
