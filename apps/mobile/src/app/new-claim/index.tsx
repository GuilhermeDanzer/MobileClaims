import { snapshotExpired } from '@/db/snapshots-repo';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useNewClaim } from '@/features/new-claim/new-claim-context';
import { usePolicies } from '@/features/policies/use-policies';
import { useTheme } from '@/hooks/use-theme';

/** Step 1 of 4 — pick the policy the claim is against. */
export default function NewClaimPolicyStep() {
  const { policyNumber, setPolicyNumber } = useNewClaim();
  const policies = usePolicies();
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top']}>
        <ScreenHeader title="New claim" />
      </SafeAreaView>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Which policy does this claim relate to?
        </ThemedText>

        {policies.cachedAt && snapshotExpired(policies.cachedAt) ? <ThemedText type="small">Saved policy information is over 15 minutes old. It remains available for offline selection.</ThemedText> : null}
        {policies.cachedAt ? <ThemedText type="small">Policies last refreshed {new Date(policies.cachedAt).toLocaleString()}. Policy ownership and active status are checked when sent; saved information may be outdated.</ThemedText> : null}
        {policies.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {policies.isError ? (
          <ThemedText type="small" style={styles.error}>
            {policies.data ? 'Could not refresh policies. You can select a saved policy; it may be outdated.' : 'No policies available on this device. Connect to load your policies.'}
          </ThemedText>
        ) : null}

        {policies.isError ? <PrimaryButton label="Retry policy refresh" onPress={() => void policies.refetch()} /> : null}
        {policies.data?.length === 0 ? <ThemedText type="small">No policies found for this account.</ThemedText> : null}
        {(policies.data ?? []).map((policy) => {
          const selected = policy.policyNumber === policyNumber;
          return (
            <Pressable
              key={policy.policyNumber}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: !policy.active }}
              disabled={!policy.active}
              onPress={() => setPolicyNumber(policy.policyNumber)}
              style={[
                styles.card,
                { backgroundColor: theme.backgroundElement, borderColor: selected ? theme.primary : theme.backgroundSelected },
                !policy.active && styles.inactive,
              ]}>
              <ThemedText type="smallBold">{policy.product}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {policy.policyNumber}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {policy.coverageSummary ?? 'No summary'}
              </ThemedText>
              {!policy.active ? (
                <ThemedText type="small" style={styles.error}>
                  Inactive
                </ThemedText>
              ) : null}
            </Pressable>
          );
        })}

        <View style={styles.footer}>
          <PrimaryButton
            label="Next"
            disabled={!policyNumber}
            onPress={() => router.push('/new-claim/details')}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  hint: { marginBottom: Spacing.two },
  loading: { marginVertical: Spacing.four },
  error: { color: theme.error },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  inactive: { opacity: 0.5 },
  footer: { marginTop: Spacing.four },
});
