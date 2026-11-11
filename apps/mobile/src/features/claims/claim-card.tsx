import type { ClaimSummary } from '@northwind/contracts';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/lib/format';
import { Spacing } from '@/constants/theme';
import { serverStatusCopy } from './status-copy';

/** A claim that the platform is tracking (server-side), shown on the dashboard. */
export function ClaimCard({ claim }: { claim: ClaimSummary }) {
  const theme = useTheme();
  const copy = serverStatusCopy(claim.intakeStatus, claim.latestStatus);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/claims/[claimId]', params: { claimId: claim.claimId } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold">{claim.reference}</ThemedText>
      <ThemedText type="small" style={styles.status}>
        {copy.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{copy.detail}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDate(claim.createdAt)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  pressed: { opacity: 0.7 },
  status: { marginTop: Spacing.one },
});
