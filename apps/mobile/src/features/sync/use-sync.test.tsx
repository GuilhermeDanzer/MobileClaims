import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { SyncProvider, useSync } from './use-sync';
import { runSync } from './sync-engine';

jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient }));
jest.mock('@/db/database', () => ({ getDatabase: async () => ({}) }));
jest.mock('@/features/session/session-context', () => ({ useSession: () => ({ status: 'signedIn', token: 'test' }) }));
jest.mock('@/features/claims/api', () => ({ completeDocument: jest.fn(), fetchClaim: jest.fn(), fetchDocumentUploadUrl: jest.fn(), submitClaim: jest.fn() }));
jest.mock('./sync-engine', () => ({ runSync: jest.fn() }));
jest.mock('./upload', () => ({ uploadToPresignedUrl: jest.fn() }));
jest.mock('expo-network', () => ({ addNetworkStateListener: () => ({ remove: jest.fn() }) }));
const mockClient = { invalidateQueries: jest.fn() };
function Probe() { const { error } = useSync(); return <Text>{error ?? 'Ready'}</Text>; }

test('foreground retries continue after backoff; sync errors are visible and timer is removed', async () => {
  jest.useFakeTimers();
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  const mocked = jest.mocked(runSync);
  mocked.mockRejectedValueOnce(new Error('SQLite unavailable')).mockResolvedValue(false);
  const view = await render(<SyncProvider><Probe /></SyncProvider>);
  await act(async () => { jest.advanceTimersByTime(0); });
  expect(view.getByText(/Could not sync/)).toBeTruthy();
  const before = mocked.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(5_000); });
  expect(mocked.mock.calls.length).toBe(before + 1);
  expect(view.getByText('Ready')).toBeTruthy();
  await view.unmount();
  const after = mocked.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(mocked.mock.calls.length).toBe(after);
  AppState.currentState = previousState;
  jest.useRealTimers();
});
