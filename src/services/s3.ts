import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';
import { ApiError } from '../errors';

const MAX_PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PUT_TTL_SECONDS = 300;
const DEFAULT_GET_TTL_SECONDS = 900;

let client: S3Client | undefined;

export type UploadPurpose =
  | 'selfie'
  | 'document'
  | 'avatar'
  | 'chat'
  | 'leave'
  | 'task'
  | 'payroll-import'
  | 'payroll-slip';

export type PutBody = PutObjectCommandInput['Body'];

export interface PresignedPut {
  key: string;
  url: string;
  headers: { 'Content-Type': string };
  expiresIn: number;
}

export interface BuildUploadKeyInput {
  purpose: UploadPurpose;
  contentType: string;
  filename?: string;
  employeeId?: string;
  docId?: string;
  conversationId?: string;
  messageId?: string;
  leaveId?: string;
  taskId?: string;
  payrollMonth?: string;
}

export interface BuildUploadKeyOptions {
  actorEmployeeId?: string;
  now?: Date;
}

function requireS3Env() {
  if (!env.S3_BUCKET) {
    throw new ApiError(500, 'S3_NOT_CONFIGURED', 'S3_BUCKET is required');
  }

  if (!env.S3_REGION && !env.R2_ACCOUNT_ID && !env.S3_ENDPOINT) {
    throw new ApiError(500, 'S3_NOT_CONFIGURED', 'S3_REGION is required');
  }

  if ((env.S3_REGION ?? 'auto') === 'auto' && !env.R2_ACCOUNT_ID && !env.S3_ENDPOINT) {
    throw new ApiError(
      500,
      'S3_NOT_CONFIGURED',
      'R2_ACCOUNT_ID or S3_ENDPOINT is required when S3_REGION is auto',
    );
  }

  return {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION ?? 'auto',
  };
}

function endpoint() {
  if (env.S3_ENDPOINT) return env.S3_ENDPOINT;
  if (env.R2_ACCOUNT_ID) return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return undefined;
}

function s3Client() {
  const { region } = requireS3Env();

  client ??= new S3Client({
    region,
    credentials:
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
    endpoint: endpoint(),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    maxAttempts: 3,
  });

  return client;
}

function clampTtl(seconds: number | undefined, fallback: number) {
  if (seconds === undefined) return fallback;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ApiError(422, 'INVALID_TTL', 'expiresIn must be a positive number');
  }

  return Math.min(Math.floor(seconds), MAX_PRESIGN_TTL_SECONDS);
}

function assertContentType(contentType: string) {
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;.*)?$/i.test(contentType)) {
    throw new ApiError(422, 'INVALID_CONTENT_TYPE', 'contentType must be a valid MIME type');
  }
}

function assertKey(key: string) {
  if (!key || key.length > 1024 || key.startsWith('/') || key.includes('\\') || key.includes('..')) {
    throw new ApiError(422, 'INVALID_S3_KEY', 'Invalid S3 object key');
  }
}

function requireValue(value: string | undefined, field: string) {
  if (!value?.trim()) {
    throw new ApiError(422, 'MISSING_UPLOAD_FIELD', `${field} is required`);
  }

  return value.trim();
}

function datePart(now: Date) {
  return now.toISOString().slice(0, 10);
}

function compactTimestamp(now: Date) {
  return now.toISOString().replace(/[-:.TZ]/g, '');
}

function sanitizeSegment(value: string) {
  const safe = value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120);

  if (!safe) {
    throw new ApiError(422, 'INVALID_UPLOAD_NAME', 'Upload name is invalid');
  }

  return safe;
}

function extensionFrom(input: BuildUploadKeyInput) {
  const fileExt = input.filename?.match(/\.([a-zA-Z0-9]{1,12})$/)?.[1];
  if (fileExt) return fileExt.toLowerCase();

  const subtype = input.contentType.split('/')[1]?.split(';')[0]?.toLowerCase();
  if (!subtype) return 'bin';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype.includes('spreadsheet') || subtype.includes('excel')) return 'xlsx';
  if (subtype === 'plain') return 'txt';
  return subtype.replace(/[^a-z0-9]/g, '').slice(0, 12) || 'bin';
}

function requirePayrollMonth(value: string | undefined) {
  const month = requireValue(value, 'payrollMonth');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new ApiError(422, 'INVALID_PAYROLL_MONTH', 'payrollMonth must be YYYY-MM');
  }

  return month;
}

export function buildUploadKey(input: BuildUploadKeyInput, options: BuildUploadKeyOptions = {}) {
  assertContentType(input.contentType);

  const now = options.now ?? new Date();
  const ts = compactTimestamp(now);
  const employeeId = input.employeeId ?? options.actorEmployeeId;

  switch (input.purpose) {
    case 'selfie':
      return `selfies/${requireValue(employeeId, 'employeeId')}/${datePart(now)}/${ts}.${extensionFrom(input)}`;
    case 'document':
      return `documents/${requireValue(employeeId, 'employeeId')}/${requireValue(input.docId, 'docId')}.${extensionFrom(input)}`;
    case 'avatar':
      return `avatars/${requireValue(employeeId, 'employeeId')}.${extensionFrom(input)}`;
    case 'chat':
      return `chat/${requireValue(input.conversationId, 'conversationId')}/${requireValue(input.messageId, 'messageId')}/${sanitizeSegment(
        requireValue(input.filename, 'filename'),
      )}`;
    case 'leave':
      return `leaves/${requireValue(input.leaveId, 'leaveId')}/${sanitizeSegment(requireValue(input.filename, 'filename'))}`;
    case 'task':
      return `tasks/${requireValue(input.taskId, 'taskId')}/${sanitizeSegment(requireValue(input.filename, 'filename'))}`;
    case 'payroll-import':
      return `payroll-imports/${input.payrollMonth ?? datePart(now).slice(0, 7)}/${ts}.xlsx`;
    case 'payroll-slip':
      return `payroll-slips/${requireValue(employeeId, 'employeeId')}/${requirePayrollMonth(input.payrollMonth)}.pdf`;
  }
}

export async function putObject(
  key: string,
  body: PutBody,
  contentType: string,
  options: {
    contentLength?: number;
    metadata?: Record<string, string>;
    cacheControl?: string;
    contentDisposition?: string;
  } = {},
) {
  const { bucket } = requireS3Env();
  assertKey(key);
  assertContentType(contentType);

  const out = await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: options.contentLength,
      Metadata: options.metadata,
      CacheControl: options.cacheControl,
      ContentDisposition: options.contentDisposition,
    }),
  );

  return {
    key,
    bucket,
    etag: out.ETag,
    versionId: out.VersionId,
  };
}

export async function presignPut(key: string, contentType: string, expiresIn?: number): Promise<PresignedPut> {
  const { bucket } = requireS3Env();
  assertKey(key);
  assertContentType(contentType);

  const ttl = clampTtl(expiresIn, DEFAULT_PUT_TTL_SECONDS);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return {
    key,
    url: await getSignedUrl(s3Client(), command, {
      expiresIn: ttl,
      signableHeaders: new Set(['content-type']),
    }),
    headers: { 'Content-Type': contentType },
    expiresIn: ttl,
  };
}

export async function presignGet(
  key: string,
  expiresIn?: number,
  options: { filename?: string } = {},
) {
  const { bucket } = requireS3Env();
  assertKey(key);

  const ttl = clampTtl(expiresIn, DEFAULT_GET_TTL_SECONDS);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: options.filename
      ? `attachment; filename="${sanitizeSegment(options.filename)}"`
      : undefined,
  });

  return {
    key,
    url: await getSignedUrl(s3Client(), command, { expiresIn: ttl }),
    expiresIn: ttl,
  };
}

export async function headObject(key: string) {
  const { bucket } = requireS3Env();
  assertKey(key);

  const out = await s3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

  return {
    key,
    size: out.ContentLength,
    contentType: out.ContentType,
    modified: out.LastModified,
    etag: out.ETag,
    metadata: out.Metadata,
  };
}

export async function deleteObject(key: string) {
  const { bucket } = requireS3Env();
  assertKey(key);

  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return { key, deleted: true };
}

export function destroyS3Client() {
  client?.destroy();
  client = undefined;
}
