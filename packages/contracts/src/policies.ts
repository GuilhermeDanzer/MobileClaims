import { z } from 'zod';

/** A policy the customer can select when creating a claim (read-only snapshot, ADR A4). */
export const policySchema = z.object({
  policyNumber: z.string(),
  product: z.string(),
  coverageSummary: z.string().nullable(),
  active: z.boolean(),
});
export type Policy = z.infer<typeof policySchema>;

/** GET /v1/policies — the customer's cached policy snapshot. */
export const policyListResponseSchema = z.object({
  policies: z.array(policySchema),
});
export type PolicyListResponse = z.infer<typeof policyListResponseSchema>;
