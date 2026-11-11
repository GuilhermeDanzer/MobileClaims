import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import NewClaimLayout from '@/app/new-claim/_layout';
import { useNewClaim } from './new-claim-context';

let mockDraftId: string | undefined = 'draft-1';
function MockScreen() { const draft = useNewClaim(); return <Text>{draft.draftId}:{draft.incidentDescription}</Text>; }
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ draftId: mockDraftId }), Stack: () => <MockScreen /> }));
jest.mock('@/features/session/session-context', () => ({ useSession: () => ({ customerId: 'A' }) }));
jest.mock('@/db/database', () => ({ getDatabase: async () => ({}) }));
jest.mock('@/db/drafts-repo', () => ({ getDraft: async () => ({ draftId: 'draft-1', clientClaimId: 'stable-id', policyNumber: 'P1', incidentDescription: 'Saved incident', incidentDate: '2026-11-06' }) }));
jest.mock('@/db/queue-repo', () => ({ getSubmission: async () => ({ state: 'draft', claimId: null }) }));
jest.mock('@/db/attachments-repo', () => ({ listAttachments: async () => [] }));
jest.mock('./photo-capture', () => ({ capturePhoto: jest.fn() }));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));

test('reopened draft survives loss of entry-route params when navigating between wizard steps', async () => {
  mockDraftId = 'draft-1';
  const view = await render(<NewClaimLayout />);
  await waitFor(() => expect(view.getByText('draft-1:Saved incident')).toBeTruthy());
  mockDraftId = undefined;
  await view.rerender(<NewClaimLayout />);
  expect(view.getByText('draft-1:Saved incident')).toBeTruthy();
  await view.unmount();
});
