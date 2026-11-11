import { z } from 'zod';

/** Stable, machine-readable error codes. The mobile app switches on these. */
export const errorCodes = [
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CLAIM_ALREADY_EXISTS', // idempotent replay of a different payload
  'RATE_LIMITED',
  'LEGACY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    /** Open on purpose: new codes are added additively. */
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
