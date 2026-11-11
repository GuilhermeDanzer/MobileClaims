import { z } from 'zod';

/**
 * Central configuration. Every environment variable is read and validated exactly once,
 * so a missing or malformed value fails fast at startup instead of somewhere in a handler.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // 0.0.0.0 so simulators/emulators and physical devices can reach the API over LAN
  // (the mobile app derives the host from Expo's dev-server hostUri, e.g. 192.168.0.5:3000).
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://claims:claims@localhost:5432/claims'),

  STORAGE_ENDPOINT: z.string().default('http://localhost:4566'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('claims-documents'),
  STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  STORAGE_ACCESS_KEY: z.string().default('test'),
  STORAGE_SECRET_KEY: z.string().default('test'),

  APP_ENV: z.enum(['local', 'test', 'production']).default('local'),
  AUTH_MODE: z.enum(['dev', 'real']).default('dev'),
  LOG_LEVEL: z.string().default('info'),

  LEGACY_BASE_URL: z.string().default('http://localhost:4000'),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  return result.data;
}
