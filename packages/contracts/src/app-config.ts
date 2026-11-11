import { z } from 'zod';

/** Returned by GET /v1/app-config; drives version gating and feature flags. */
export const appConfigSchema = z.object({
  minSupportedVersion: z.string(),
  latestVersion: z.string(),
  features: z.record(z.string(), z.boolean()),
  stormMode: z.boolean(),
  maintenance: z.boolean(),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

/** Returned by GET /v1/me; proves which actor the token represents. */
export const meSchema = z.object({
  actor: z.enum(['customer', 'employee']),
  customerId: z.string().optional(),
  role: z.string().optional(),
});
export type Me = z.infer<typeof meSchema>;

export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  database: z.enum(['up', 'down']),
  storage: z.enum(['up', 'down']),
});
export type Health = z.infer<typeof healthSchema>;

export const claimReferenceSchema = z.object({
  claimId: z.string(),
  reference: z.string(),
  createdAt: z.string(),
});
export type ClaimReference = z.infer<typeof claimReferenceSchema>;
