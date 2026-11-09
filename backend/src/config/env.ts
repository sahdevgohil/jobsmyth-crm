import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  /** Shared secret for public website lead intake (SEC-010). Optional in test. */
  WEBSITE_LEAD_INTAKE_SECRET: z.string().min(16).optional(),
  /** Google Cloud API key for the Solar + Geocoding APIs. Server-side only; never sent to the browser. */
  GOOGLE_SOLAR_API_KEY: z.string().min(10).optional(),
  /** Root directory for the local (dev) file storage adapter. */
  FILE_STORAGE_DIR: z.string().min(1).default('./storage'),
  /** Maximum decoded size of an uploaded file, in bytes. */
  FILE_MAX_BYTES: z.coerce.number().int().positive().default(8_000_000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * `npm run dev/start` pass `--env-file=.env`, which only works when the process starts in backend/.
 * If nothing was loaded (for example the server was started from another folder), load backend/.env by its
 * absolute location instead of relying on the working directory. Existing environment variables win.
 */
function ensureBackendEnvFile(raw: NodeJS.ProcessEnv): void {
  if (raw !== process.env || process.env.NODE_ENV === 'test' || process.env.MONGODB_URI) return;
  const file = fileURLToPath(new URL('../../.env', import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  ensureBackendEnvFile(raw);
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function getEnv(): Env {
  if (!cached) {
    return loadEnv();
  }
  return cached;
}

export function getCorsOrigins(): string[] {
  return getEnv()
    .CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Reset cached env — used by tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}
