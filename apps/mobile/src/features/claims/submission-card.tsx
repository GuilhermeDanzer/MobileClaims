import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { DashboardSubmissionRow } from '@/db/queue-repo';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/lib/format';
import { useSync } from '@/features/sync/use-sync';
import { deviceStateCopy } from './status-copy';

/** A local draft or in-flight submission, shown on the dashboard alongside server claims. */
export function SubmissionCard({ item }: { item: DashboardSubmissionRow }) {
  const { uploads } = useSync();
  const theme = useTheme();
  const styles = createStyles(theme);
  const copy = deviceStateCopy(item.state, item.reference);
  const isDraft = item.state === 'draft' || (item.state === 'needs_attention' && !item.claimId);

  function openItem() {
    if (isDraft) router.push({ pathname: '/new-claim', params: { draftId: item.draftId } });
    else if (item.claimId) router.push({ pathname: '/claims/[claimId]', params: { claimId: item.claimId } });
  }

  return (
    <Pressable
      accessibilityRole={isDraft || item.claimId ? 'button' : undefined}
      onPress={isDraft || item.claimId ? openItem : undefined}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold">{copy.title}</ThemedText>
      <ThemedText type="small" style={styles.status}>
        {item.policyNumber}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{copy.detail}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDate(item.updatedAt)}
      </ThemedText>
      {item.attempts > 0 ? (
        <ThemedText type="small">
          Send attempts: {item.attempts} · next retry {new Date(item.nextAttemptAt).toLocaleTimeString()}
        </ThemedText>
      ) : null}
      {item.pendingFiles.map((file) => {
        const progress = uploads[`${item.draftId}:${file.attachmentId}`];
        const status = progress && progress.total > 0
          ? `${Math.min(100, Math.round(progress.sent / progress.total * 100))}% sent · awaiting confirmation`
          : file.uploadState === 'uploading' ? 'Uploading' : 'Waiting for upload';
        return (
          <ThemedText key={file.attachmentId} type="small">{file.fileName} · {status}</ThemedText>
        );
      })}
      {item.lastError ? (
        <ThemedText type="small" style={styles.error}>
          {item.lastError}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  pressed: { opacity: 0.7 },
  status: { marginTop: Spacing.one },
  error: { color: theme.error, marginTop: Spacing.one },
});
