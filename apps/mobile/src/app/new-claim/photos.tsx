import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useNewClaim } from '@/features/new-claim/new-claim-context';
import { useTheme } from '@/hooks/use-theme';

/** Step 3 of 4 — capture or select photographs (optional but encouraged). */
export default function NewClaimPhotosStep() {
  const { attachments, addPhoto, removePhoto } = useNewClaim();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const styles = createStyles(theme);

  async function onAdd(source: 'camera' | 'library') {
    setBusy(true);
    setError(null);
    const result = await addPhoto(source);
    if (result) setError(result);
    setBusy(false);
  }

  async function onRemove(attachmentId: string) {
    setError(null);
    try { await removePhoto(attachmentId); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not remove this photo.'); }
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top']}>
        <ScreenHeader title="Photos" />
      </SafeAreaView>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Photographs of the damage help the claims team. You can add up to 10 files.
        </ThemedText>

        <View style={styles.row}>
          <PrimaryButton label="Take photo" disabled={busy} onPress={() => void onAdd('camera')} style={styles.captureButton} />
          <PrimaryButton label="Choose from library" disabled={busy} onPress={() => void onAdd('library')} style={styles.captureButton} variant="secondary" />
        </View>

        {error ? (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        {attachments.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No photos yet.
          </ThemedText>
        ) : (
          attachments.map((attachment) => (
            <View key={attachment.attachmentId} style={[styles.photoRow, { borderColor: theme.backgroundSelected }]}>
              <Image source={{ uri: attachment.localUri }} style={styles.thumb} contentFit="cover" />
              <View style={styles.photoMeta}>
                <ThemedText type="small" numberOfLines={1}>
                  {attachment.fileName}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${attachment.fileName}`} hitSlop={12} disabled={busy} onPress={() => void onRemove(attachment.attachmentId)}>
                <ThemedText type="small" style={styles.remove}>
                  Remove
                </ThemedText>
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.footer}>
          <PrimaryButton label="Next" onPress={() => router.push('/new-claim/review')} />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  row: { flexWrap: 'wrap', flexDirection: 'row', gap: Spacing.three },
  captureButton: { flex: 1 },
  error: { color: theme.error },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: 12, padding: Spacing.two },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  photoMeta: { flex: 1 },
  remove: { color: theme.error },
  footer: { marginTop: Spacing.four },
});
