import { policySchema } from '@northwind/contracts';
import { POLICY_TTL_MS } from '@/db/snapshots-repo';
import { useSnapshotQuery } from '@/features/cache/use-snapshot-query';
import { fetchPolicies } from './api';

const parsePolicies = (value: unknown) => policySchema.array().parse(value);

export function usePolicies() {
  return useSnapshotQuery('policies', 'list', fetchPolicies, POLICY_TTL_MS, parsePolicies);
}
