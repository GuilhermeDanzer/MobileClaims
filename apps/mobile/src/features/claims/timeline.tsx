import type { ClaimStatusEvent } from '@northwind/contracts';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime } from '@/lib/format';

/**
 * The chronological status timeline. Each event's `label` comes from the server, so unknown
 * future statuses render safely without a client-side mapping.
 */
export function StatusTimeline({ events }: { events: ClaimStatusEvent[] }) {
  const theme = useTheme();
  if (events.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No status updates yet.
      </ThemedText>
    );
  }

  return (
    <View style={styles.container}>
      {events.map((event, index) => (
        <View key={`${event.at}-${index}`} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />
          <View style={styles.meta}>
            <ThemedText type="smallBold">{event.label || event.status}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDateTime(event.at)} · {event.source === 'legacy' ? 'Claims team' : 'Platform'}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
  meta: { flex: 1 },
});
