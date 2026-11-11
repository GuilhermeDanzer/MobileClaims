import { ActivityIndicator, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/screen-header';
import { useSession } from '@/features/session/session-context';
import { Stack, useLocalSearchParams } from 'expo-router';

import { NewClaimProvider, useNewClaim } from '@/features/new-claim/new-claim-context';

/** The new-claim wizard: a nested stack wrapped in the wizard state provider. */
export default function NewClaimLayout() {
  const { customerId } = useSession();
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();

  return (
    <NewClaimProvider key={customerId} initialDraftId={draftId}>
      <WizardScreens />
    </NewClaimProvider>
  );
}

function WizardScreens() {
  const { loading, loadError } = useNewClaim();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator accessibilityLabel="Opening saved draft" /></View>;
  if (loadError) return <View style={{ flex: 1, padding: 24 }}><ScreenHeader title="Saved draft" /><ThemedText>{loadError}</ThemedText></View>;
  return <Stack screenOptions={{ headerShown: false }} />;
}
