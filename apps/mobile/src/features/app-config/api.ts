import { appConfigSchema, type AppConfig } from '@northwind/contracts';

import { apiRequest } from '@/lib/api-client';

/** Public app configuration: version gate and feature flags. */
export async function fetchAppConfig(): Promise<AppConfig> {
  const body = await apiRequest<unknown>('/v1/app-config');
  return appConfigSchema.parse(body);
}
