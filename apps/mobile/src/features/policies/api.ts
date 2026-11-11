import { policyListResponseSchema, type Policy } from '@northwind/contracts';

import { apiRequest } from '@/lib/api-client';

export async function fetchPolicies(token: string): Promise<Policy[]> {
  const body = await apiRequest<unknown>('/v1/policies', { token });
  return policyListResponseSchema.parse(body).policies;
}
