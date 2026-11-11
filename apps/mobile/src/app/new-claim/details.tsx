import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useNewClaim } from '@/features/new-claim/new-claim-context';
import { useTheme } from '@/hooks/use-theme';
import { dateInputToIso, formatDateInput, maskDate } from '@/lib/format';

/** Step 2 of 4 — incident description and date. */
export default function NewClaimDetailsStep() {
  const { incidentDescription, incidentDate, setIncidentDescription, setIncidentDate, validation } = useNewClaim();
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView edges={['top']}>
        <ScreenHeader title="Incident details" />
      </SafeAreaView>
      <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.scroll} contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          What happened?
        </ThemedText>
        <TextInput
          testID="incident-description"
          accessibilityLabel="Incident description"
          maxLength={2000}
          value={incidentDescription}
          onChangeText={setIncidentDescription}
          multiline
          numberOfLines={5}
          placeholder="Describe the incident, damage, and anything else relevant."
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.backgroundSelected }]}
        />
        {validation.errors.incidentDescription ? (
          <ThemedText type="small" style={styles.error}>
            {validation.errors.incidentDescription}
          </ThemedText>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary">
          When did it happen? (MM/DD/YYYY)
        </ThemedText>
        <TextInput
          testID="incident-date"
          accessibilityLabel="Incident date, month day year"
          value={formatDateInput(incidentDate)}
          onChangeText={(text) => setIncidentDate(dateInputToIso(maskDate(text)))}
          placeholder="MM/DD/YYYY"
          placeholderTextColor={theme.textSecondary}
          keyboardType="number-pad"
          maxLength={10}
          autoCapitalize="none"
          style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        />
        {validation.errors.incidentDate ? (
          <ThemedText type="small" style={styles.error}>
            {validation.errors.incidentDate}
          </ThemedText>
        ) : null}

        <View style={styles.footer}>
          <PrimaryButton label="Next" disabled={!validation.valid} onPress={() => router.push('/new-claim/photos')} />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    fontSize: 16,
    marginBottom: Spacing.three,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  error: { color: theme.error, marginTop: -Spacing.two, marginBottom: Spacing.two },
  footer: { marginTop: Spacing.four },
});
