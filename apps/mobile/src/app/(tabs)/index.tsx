import { useTheme } from '@/hooks/use-theme';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ClaimCard } from '@/features/claims/claim-card';
import { SubmissionCard } from '@/features/claims/submission-card';
import { useClaims } from '@/features/claims/use-claims';
import { useLocalSubmissions } from '@/features/claims/use-local-submissions';
import { useIsOnline } from '@/features/sync/network';

/**
 * The claims dashboard. One list, two sources:
 * - server claims (TanStack Query → cached in SQLite), and
 * - local drafts/in-flight submissions (SQLite), deduplicated against the server by claimId.
 */
export default function ClaimsDashboard() {
  const theme = useTheme();
  const styles = createStyles(theme);
  const claims = useClaims();
  const local = useLocalSubmissions();
  const online = useIsOnline();

  const serverClaims = claims.data ?? [];
  const serverIds = new Set(serverClaims.map((c) => c.claimId));
  const localItems = (local.data ?? []).filter((item) => item.state !== 'complete' || !item.claimId || !serverIds.has(item.claimId));
  const localClaimIds = new Set(localItems.flatMap((item) => item.claimId ? [item.claimId] : []));
  const visibleServerClaims = serverClaims.filter((claim) => !localClaimIds.has(claim.claimId));

  const loading = claims.isLoading && !claims.data;
  const errored = claims.isError && !claims.data;
  const empty = !loading && !errored && serverClaims.length === 0 && localItems.length === 0;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Claims</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/new-claim')}
            style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}>
            <ThemedText type="smallBold" style={styles.newButtonLabel}>
              + New claim
            </ThemedText>
          </Pressable>
        </View>

        {!online ? (
          <View style={styles.banner}>
            <ThemedText type="small" style={styles.bannerText}>
              Offline — new claims are saved on this device and sent when you are back online.
            </ThemedText>
          </View>
        ) : null}

        {claims.isCached ? <ThemedText type="small">Saved claims · last refreshed {new Date(claims.cachedAt!).toLocaleString()}. May be outdated.</ThemedText> : null}
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={claims.isRefetching} onRefresh={() => void claims.refetch()} />}>
          {loading ? <ActivityIndicator size="large" style={styles.center} /> : null}

          {errored ? (
            <View style={styles.centerBlock}>
              <ThemedText type="small" style={styles.errorText}>
                Could not load claims. The backend may be unavailable.
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => void claims.refetch()} style={styles.retryButton}>
                <ThemedText type="smallBold" style={styles.newButtonLabel}>
                  Retry
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {empty ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              No claims yet. Tap “New claim” to get started.
            </ThemedText>
          ) : null}

          {localItems.map((item) => (
            <SubmissionCard key={item.draftId} item={item} />
          ))}
          {visibleServerClaims.map((claim) => (
            <ClaimCard key={claim.claimId} claim={claim} />
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  newButton: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  newButtonLabel: { color: theme.onPrimary },
  pressed: { opacity: 0.7 },
  banner: { backgroundColor: theme.warningBackground, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  bannerText: { color: theme.warning },
  list: { padding: Spacing.four, gap: Spacing.three },
  center: { alignSelf: 'center', marginTop: Spacing.five },
  centerBlock: { alignItems: 'center', gap: Spacing.three, marginTop: Spacing.five },
  errorText: { color: theme.error, textAlign: 'center' },
  retryButton: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
});
