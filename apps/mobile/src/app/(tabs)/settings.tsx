import { getDatabase } from '@/db/database';
import { retryMedia } from '@/db/queue-repo';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAppConfig } from '@/features/app-config/use-app-config';
import { useLocalSubmissions } from '@/features/claims/use-local-submissions';
import { useSession } from '@/features/session/session-context';
import { isForcedOffline, requestDropNextUpload, setForceOffline } from '@/features/sync/dev-flags';
import { useSync } from '@/features/sync/use-sync';
import { useTheme } from '@/hooks/use-theme';
import { APP_VERSION, getApiBaseUrl, setApiBaseUrlOverride } from '@/lib/config';

export default function SettingsScreen() {
  const { signOut, customerId } = useSession();
  const { syncNow, syncing, uploads, error } = useSync();
  const appConfig = useAppConfig();
  const submissions = useLocalSubmissions();
  const theme = useTheme();
  const styles = createStyles(theme);

  const [retryError, setRetryError] = useState<string | null>(null);
  const [offline, setOffline] = useState(isForcedOffline());
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlDirty, setBaseUrlDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getApiBaseUrl().then(setBaseUrl);
  }, []);

  async function saveBaseUrl() {
    await setApiBaseUrlOverride(baseUrl);
    setBaseUrlDirty(false);
    setSaved(true);
  }

  async function retryUploads(draftId: string) {
    try {
      await retryMedia(await getDatabase(customerId), draftId, new Date().toISOString());
      setRetryError(null);
      await syncNow();
      await submissions.refetch();
    } catch { setRetryError('Could not retry uploads. Your saved claim is still on this device.'); }
  }

  const uploadCount = Object.keys(uploads).length;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Settings</ThemedText>

          <ThemedText type="smallBold" style={styles.section}>
            Account
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Demo customer (local dev identity)
          </ThemedText>
          <PrimaryButton label="Sign out" variant="destructive" onPress={() => void signOut()} style={styles.signOut} />

          <ThemedText type="smallBold" style={styles.section}>
            App
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Version {APP_VERSION}
            {appConfig.data ? ` · latest ${appConfig.data.latestVersion}` : ''}
          </ThemedText>
          {appConfig.data?.maintenance ? (
            <ThemedText type="small" style={styles.warn}>
              Maintenance in progress — submissions may be delayed.
            </ThemedText>
          ) : null}
          {appConfig.data?.stormMode ? (
            <ThemedText type="small" style={styles.warn}>
              High demand — submissions may take longer than usual.
            </ThemedText>
          ) : null}

          <ThemedText type="small" themeColor="textSecondary" style={styles.section}>
            API base URL (for physical devices)
          </ThemedText>
          <TextInput
            accessibilityLabel="API base URL"
            testID="api-base-url"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
            value={baseUrl}
            onChangeText={(value) => {
              setBaseUrl(value);
              setBaseUrlDirty(true);
              setSaved(false);
            }}
            autoCapitalize="none"
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          {baseUrlDirty ? <PrimaryButton label="Save" onPress={() => void saveBaseUrl()} /> : null}
          {saved ? (
            <ThemedText type="small" themeColor="textSecondary">
              Saved — applies on next request.
            </ThemedText>
          ) : null}

          <ThemedText type="smallBold" style={styles.section}>
            Diagnostics
          </ThemedText>
          <View style={styles.row}>
            <ThemedText type="small">Force offline</ThemedText>
            <Switch
              accessibilityLabel="Force offline"
              testID="force-offline"
              value={offline}
              onValueChange={(value) => {
                setOffline(value);
                setForceOffline(value);
              }}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => requestDropNextUpload()}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <ThemedText type="small">Drop the next upload (simulate interruption)</ThemedText>
          </Pressable>
          <View style={styles.row}>
            <ThemedText type="small">{syncing ? 'Syncing…' : 'Sync now'}</ThemedText>
            <PrimaryButton label="Run" onPress={() => void syncNow()} disabled={syncing} style={styles.runButton} />
          </View>
          {error ? <ThemedText type="small" style={styles.warn}>{error}</ThemedText> : null}
          {uploadCount > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {uploadCount} upload(s) in progress or just finished.
            </ThemedText>
          ) : null}

          <ThemedText type="smallBold" style={styles.section}>
            Local submissions ({submissions.data?.length ?? 0})
          </ThemedText>
          {retryError ? <ThemedText type="small">{retryError}</ThemedText> : null}
          {(submissions.data ?? []).map((item) => (
            <View key={item.draftId} style={styles.queueRow}>
              <ThemedText type="small">{item.state}</ThemedText>
              {item.claimId && ['media_pending', 'needs_attention'].includes(item.state) ? <PrimaryButton label="Retry uploads" disabled={syncing} onPress={() => void retryUploads(item.draftId)} /> : null}
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {item.reference ?? item.policyNumber}
              </ThemedText>
            </View>
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
  content: { padding: Spacing.four, gap: Spacing.two },
  section: { marginTop: Spacing.four },
  signOut: { marginTop: Spacing.two },
  warn: { color: theme.warning },
  input: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  action: { paddingVertical: Spacing.two },
  pressed: { opacity: 0.6 },
  runButton: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three },
  queueRow: { flexWrap: 'wrap', flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
});
