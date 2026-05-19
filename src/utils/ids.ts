import { ObjectId } from 'mongodb';

export function isValidObjectId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return ObjectId.isValid(value);
}

export function toObjectId(value: string): ObjectId {
  return new ObjectId(value);
}

export function toObjectIdOrNull(value: string | undefined | null): ObjectId | null {
  if (!value || !ObjectId.isValid(value)) return null;
  return new ObjectId(value);
}
