import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DocumentList } from '@/features/claims/document-list';
import { serverStatusCopy } from '@/features/claims/status-copy';
import { StatusTimeline } from '@/features/claims/timeline';
import { useClaim, useClaimEvents } from '@/features/claims/use-claims';
import { formatDate } from '@/lib/format';

/** Claim detail: information, documents, and the chronological status timeline. */
export default function ClaimDetailScreen() {
  const { claimId } = useLocalSearchParams<{ claimId: string }>();
  const claimQuery = useClaim(claimId);
  const eventsQuery = useClaimEvents(claimId);

  const claim = claimQuery.data;
  const events = eventsQuery.data ?? [];

  const latestStatus = claim && events.length > 0 ? events[events.length - 1]!.status : null;
  const copy = claim ? serverStatusCopy(claim.intakeStatus, latestStatus) : null;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title="Claim details" />
        {!claim ? (
          <View style={styles.center}>
            {claimQuery.isLoading ? <ActivityIndicator size="large" /> : <ThemedText type="small">Claim not found.</ThemedText>}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {claimQuery.isCached ? <ThemedText type="small">Saved information · last refreshed {new Date(claimQuery.cachedAt!).toLocaleString()}. May be outdated.</ThemedText> : null}
            {eventsQuery.isCached ? <ThemedText type="small">Saved status history · last refreshed {new Date(eventsQuery.cachedAt!).toLocaleString()}.</ThemedText> : null}
            {eventsQuery.isError && !eventsQuery.data ? <ThemedText type="small">Status history unavailable. Reconnect to refresh.</ThemedText> : null}
            <ThemedText type="smallBold">{claim.reference}</ThemedText>
            <ThemedText type="subtitle" style={styles.statusTitle}>
              {copy?.title}
            </ThemedText>
            {copy?.detail ? (
              <ThemedText type="small" themeColor="textSecondary">
                {copy.detail}
              </ThemedText>
            ) : null}

            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary">
                Policy
              </ThemedText>
              <ThemedText type="small">{claim.policyNumber ?? '—'}</ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary">
                Incident
              </ThemedText>
              <ThemedText type="small">{claim.incidentDate ? formatDate(claim.incidentDate) : '—'}</ThemedText>
              <ThemedText type="small">{claim.incidentDescription ?? '—'}</ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText type="smallBold">Documents</ThemedText>
              <DocumentList documents={claim.documents} />
            </View>

            <View style={styles.section}>
              <ThemedText type="smallBold">Status history</ThemedText>
              <StatusTimeline events={events} />
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 24, lineHeight: 30, marginTop: Spacing.one },
  section: { marginTop: Spacing.three, gap: Spacing.one },
});
