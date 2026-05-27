import { z } from 'zod';

const EnvSchema = z.object({
  // Phase 1 required
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),

  // Phase 1 optional with defaults
  API_PORT: z.coerce.number().int().positive().default(6000),
  HOST: z.string().default('localhost'),
  API_VERSION: z.string().default('v1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173,http://localhost:8081'),

  // Future phases — optional for now
  MONGO_URI: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
  OFFICE_LAT: z.coerce.number().optional(),
  OFFICE_LNG: z.coerce.number().optional(),
  OFFICE_RADIUS_M: z.coerce.number().optional(),
  SES_FROM: z.string().optional(),

  // Mobile client gating
  MOBILE_MIN_VERSION: z.string().default('1.0.0'),
  MOBILE_CURRENT_VERSION: z.string().default('1.0.0'),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`[env] Invalid or missing environment variables:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
