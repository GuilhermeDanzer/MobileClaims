import { useSession } from '@/features/session/session-context';
import { useQuery } from '@tanstack/react-query';

import { getDatabase } from '@/db/database';
import { listDashboardSubmissions } from '@/db/queue-repo';

/** Local drafts + in-flight submissions, read from SQLite (fast, keeps the UI in sync). */
export function useLocalSubmissions() {
  const { customerId } = useSession();
  return useQuery({
    queryKey: ['submissions', 'local', customerId],
    queryFn: async () => {
      const db = await getDatabase(customerId);
      return listDashboardSubmissions(db);
    },
    enabled: !!customerId,
    refetchInterval: 3_000,
  });
}
