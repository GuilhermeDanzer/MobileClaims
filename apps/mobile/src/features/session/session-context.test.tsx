import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SessionProvider, useSession } from './session-context';
import { queryClient } from '@/lib/query-client';

const jwt = (sub: string) => `h.${globalThis.btoa(JSON.stringify({ iss: 'test:customer', sub }))}.s`;
let mockStored: string | null;
let mockNextToken: string;
let mockUnauthorized: ((token: string | null) => void) | null;
jest.mock('@/lib/session', () => ({
  getStoredToken: async () => mockStored,
  signInDev: async () => { mockStored = mockNextToken; },
  signOut: async () => { mockStored = null; },
}));
jest.mock('@/lib/api-client', () => ({ setUnauthorizedHandler: (handler: typeof mockUnauthorized) => { mockUnauthorized = handler; } }));
function Probe() {
  const session = useSession();
  return <><Text>{session.status}:{session.customerId}</Text><Pressable onPress={() => void session.signOut()}><Text>Logout</Text></Pressable><Pressable onPress={() => void session.signIn()}><Text>Login</Text></Pressable></>;
}
afterEach(() => queryClient.clear());
test('logout clears memory, login uses the next customer, and an old-token 401 cannot sign them out', async () => {
  const a = jwt('A');
  mockStored = a;
  mockNextToken = jwt('B');
  const view = await render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(view.getByText(/signedIn:.*A/)).toBeTruthy());
  queryClient.setQueryData(['claims', 'A'], ['private']);
  await fireEvent.press(view.getByText('Logout'));
  await waitFor(() => expect(view.getByText(/signedOut/)).toBeTruthy());
  expect(queryClient.getQueryData(['claims', 'A'])).toBeUndefined();
  await fireEvent.press(view.getByText('Login'));
  await waitFor(() => expect(view.getByText(/signedIn:.*B/)).toBeTruthy());
  mockUnauthorized?.(a);
  expect(view.getByText(/signedIn:.*B/)).toBeTruthy();
  await view.unmount();
  expect(mockUnauthorized).toBeNull();
});
