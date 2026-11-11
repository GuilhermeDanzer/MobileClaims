import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useNewClaim } from '@/features/new-claim/new-claim-context';
import { usePolicies } from '@/features/policies/use-policies';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/lib/format';

/** Step 4 of 4 — review everything, then save as draft or submit. */
export default function NewClaimReviewStep() {
  const { policyNumber, incidentDescription, incidentDate, attachments, saveDraft, submit } = useNewClaim();
  const policies = usePolicies();
  const theme = useTheme();
  const styles = createStyles(theme);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const policy = (policies.data ?? []).find((p) => p.policyNumber === policyNumber);

  async function onSave() {
    setBusy('save');
    setError(null);
    try {
      await saveDraft();
      router.replace('/');
    } catch {
      setError('Could not save the draft.');
      setBusy(null);
    }
  }

  async function onSubmit() {
    setBusy('submit');
    setError(null);
    try {
      await submit();
      router.replace('/');
    } catch {
      setError('Could not submit. Please try again.');
      setBusy(null);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top']}>
        <ScreenHeader title="Review & submit" />
      </SafeAreaView>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ThemedText type="smallBold">Policy</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {policy ? `${policy.product} · ${policy.policyNumber}` : policyNumber}
        </ThemedText>

        <ThemedText type="smallBold" style={styles.section}>
          Incident
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDate(incidentDate)}
        </ThemedText>
        <ThemedText type="small">{incidentDescription}</ThemedText>

        <ThemedText type="smallBold" style={styles.section}>
          Attachments ({attachments.length})
        </ThemedText>
        {attachments.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            None
          </ThemedText>
        ) : (
          attachments.map((attachment) => (
            <View key={attachment.attachmentId} style={styles.thumbRow}>
              <Image source={{ uri: attachment.localUri }} style={styles.thumb} contentFit="cover" />
              <ThemedText type="small" numberOfLines={1} style={styles.thumbName}>
                {attachment.fileName}
              </ThemedText>
            </View>
          ))
        )}

        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          Submitting adds the claim to the send queue on this device. It shows as “Submitted”
          only after the backend confirms receipt.
        </ThemedText>

        {error ? (
          <ThemedText type="small" style={styles.errorText}>
            {error}
          </ThemedText>
        ) : null}

        <View style={styles.footer}>
          <PrimaryButton label="Submit claim" disabled={busy !== null} onPress={() => void onSubmit()} />
          <PrimaryButton
            label={busy === 'save' ? 'Saving…' : 'Save as draft'}
            disabled={busy !== null}
            onPress={() => void onSave()}
            variant="secondary"
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two },
  section: { marginTop: Spacing.three },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbName: { flex: 1 },
  note: { marginTop: Spacing.three },
  errorText: { color: theme.error },
  footer: { marginTop: Spacing.four, gap: Spacing.three },
});
