import {
  claimListResponseSchema,
  claimSchema,
  createClaimResponseSchema,
  documentUploadSchema,
  statusEventsResponseSchema,
  type Claim,
  type ClaimStatusEvent,
  type ClaimSummary,
  type CreateClaimRequest,
} from '@northwind/contracts';

import { apiRequest } from '@/lib/api-client';

/** Typed, validated calls to the claims API. Shared zod schemas parse the responses. */

export async function fetchClaims(token: string): Promise<ClaimSummary[]> {
  const body = await apiRequest<unknown>('/v1/claims', { token });
  return claimListResponseSchema.parse(body).claims;
}

export async function fetchClaim(token: string, claimId: string): Promise<Claim> {
  const body = await apiRequest<unknown>(`/v1/claims/${claimId}`, { token });
  return claimSchema.parse(body);
}

export async function fetchStatusEvents(token: string, claimId: string): Promise<ClaimStatusEvent[]> {
  const body = await apiRequest<unknown>(`/v1/claims/${claimId}/events`, { token });
  return statusEventsResponseSchema.parse(body).events;
}

export async function submitClaim(token: string, request: CreateClaimRequest): Promise<{ claimId: string; reference: string }> {
  const body = await apiRequest<unknown>('/v1/claims', { method: 'POST', body: request, token });
  return createClaimResponseSchema.parse(body);
}

export async function fetchDocumentUploadUrl(token: string, claimId: string, documentId: string): Promise<string> {
  const body = await apiRequest<unknown>(`/v1/claims/${claimId}/documents/${documentId}/upload-url`, { method: 'POST', token });
  return documentUploadSchema.parse(body).uploadUrl;
}

export async function completeDocument(token: string, claimId: string, documentId: string): Promise<void> {
  await apiRequest<unknown>(`/v1/claims/${claimId}/documents/${documentId}/complete`, { method: 'POST', token });
}
