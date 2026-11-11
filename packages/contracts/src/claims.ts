import { z } from 'zod';

/** A single declared attachment, uploaded after the claim is accepted (ADR-003). */
export const documentManifestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentLength: z.number().int().positive().max(10 * 1024 * 1024),
  contentType: z.enum(['image/jpeg', 'image/heic', 'image/png', 'application/pdf']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});
export type DocumentManifest = z.infer<typeof documentManifestSchema>;

export const createClaimRequestSchema = z.object({
  /** Client-generated idempotency key (ADR-004); stable across retries. */
  clientClaimId: z.string().uuid(),
  policyNumber: z.string().min(1),
  incidentDescription: z.string().max(2000),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  documents: z.array(documentManifestSchema).max(10),
});
export type CreateClaimRequest = z.infer<typeof createClaimRequestSchema>;

export const documentUploadSchema = z.object({
  documentId: z.string().uuid(),
  uploadUrl: z.string().url(),
});
export type DocumentUpload = z.infer<typeof documentUploadSchema>;

export const createClaimResponseSchema = z.object({
  claimId: z.string().uuid(),
  reference: z.string(),
  intakeStatus: z.string(),
  createdAt: z.string(),
  // The API returns `uploads` (see apps/api/src/modules/claims/routes.ts), not `documents`.
  uploads: z.array(documentUploadSchema),
});
export type CreateClaimResponse = z.infer<typeof createClaimResponseSchema>;

export const documentSchema = z.object({
  documentId: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  status: z.string(),
  scanStatus: z.string(),
});
export type ClaimDocument = z.infer<typeof documentSchema>;

export const claimSchema = z.object({
  claimId: z.string().uuid(),
  reference: z.string(),
  policyNumber: z.string().nullable(),
  intakeStatus: z.string(),
  incidentDescription: z.string().nullable(),
  incidentDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  documents: z.array(documentSchema),
});
export type Claim = z.infer<typeof claimSchema>;

export const claimStatusEventSchema = z.object({
  status: z.string(),
  label: z.string(),
  at: z.string(),
  source: z.enum(['platform', 'legacy']),
});
export type ClaimStatusEventSchema = z.infer<typeof claimStatusEventSchema>;

/** One row of GET /v1/claims (the dashboard list). */
export const claimSummarySchema = z.object({
  claimId: z.string().uuid(),
  reference: z.string(),
  intakeStatus: z.string(),
  latestStatus: z.string().nullable(),
  createdAt: z.string(),
});
export type ClaimSummary = z.infer<typeof claimSummarySchema>;

/** GET /v1/claims — a list wrapped for forward-compatible extension. */
export const claimListResponseSchema = z.object({
  claims: z.array(claimSummarySchema),
});
export type ClaimListResponse = z.infer<typeof claimListResponseSchema>;

/** GET /v1/claims/:claimId/events — the status timeline. */
export const statusEventsResponseSchema = z.object({
  events: z.array(claimStatusEventSchema),
});
export type StatusEventsResponse = z.infer<typeof statusEventsResponseSchema>;
