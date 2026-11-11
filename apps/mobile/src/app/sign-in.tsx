import { PrimaryButton } from '@/components/primary-button';
import { useTheme } from '@/hooks/use-theme';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';

/**
 * Local dev sign-in. There is no real credential step: the API's dev identity endpoint
 * (`POST /dev/auth/customer`) issues a customer token for the single seeded demo customer.
 * Production replaces this with a Cognito-hosted flow; this screen is Level B.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  const { signIn } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch {
      setError('Could not reach the API. Check that the backend is running.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <ThemedText type="title" style={styles.title}>
          Northwind{'\n'}Mutual
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Mobile claims, demo environment
        </ThemedText>
        <View style={styles.spacer} />
        <PrimaryButton
          label={busy ? 'Signing in…' : 'Continue as demo customer'}
          onPress={() => void onSignIn()}
          disabled={busy}
        />
        {error ? (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  title: { fontSize: 44, lineHeight: 48, marginBottom: Spacing.two },
  spacer: { height: Spacing.six },
  error: { color: theme.error, marginTop: Spacing.three },
});
