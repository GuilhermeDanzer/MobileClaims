import { claimSchema, claimSummarySchema, claimStatusEventSchema } from '@northwind/contracts';
import { useSnapshotQuery } from '@/features/cache/use-snapshot-query';
import { fetchClaim, fetchClaims, fetchStatusEvents } from './api';

const parseSummaries = (value: unknown) => claimSummarySchema.array().parse(value);
const parseClaim = (value: unknown) => claimSchema.parse(value);
const parseEvents = (value: unknown) => claimStatusEventSchema.array().parse(value);


export function useClaims() {
  return useSnapshotQuery('claims', 'list', fetchClaims, 5_000, parseSummaries);
}
export function useClaim(claimId: string) {
  return useSnapshotQuery('claims', `detail:${claimId}`, (token) => fetchClaim(token, claimId), 5_000, parseClaim);
}
export function useClaimEvents(claimId: string) {
  return useSnapshotQuery('claims', `events:${claimId}`, (token) => fetchStatusEvents(token, claimId), 5_000, parseEvents);
}
