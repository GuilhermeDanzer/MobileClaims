import { QueryClient } from '@tanstack/react-query';

/** A single app-wide QueryClient. Created once at module scope. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Claims change behind the scenes (worker + reconciliation); never cache forever.
      staleTime: 5_000,
      retry: 1,
    },
  },
});
