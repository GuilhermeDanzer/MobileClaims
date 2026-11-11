import { useQuery } from '@tanstack/react-query';

import { fetchAppConfig } from './api';

/** Version gate / feature flags. Public endpoint, no auth. */
export function useAppConfig() {
  return useQuery({ queryKey: ['app-config'], queryFn: fetchAppConfig, retry: false });
}
