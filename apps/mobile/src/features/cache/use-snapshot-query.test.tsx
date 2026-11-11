import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { useSnapshotQuery } from './use-snapshot-query';
import type { Snapshot } from '@/db/snapshots-repo';

let mockOwner: string | null = 'A';
let mockOnline = true;
const mockDisk = new Map<string, Snapshot<string[]>>();
const mockFetch = jest.fn<Promise<string[]>, [string]>();
let mockRead: (() => Promise<Snapshot<string[]> | null>) | null = null;
jest.mock('@/features/session/session-context', () => ({ useSession: () => ({ customerId: mockOwner, token: mockOwner ? `token-${mockOwner}` : null }) }));
jest.mock('@/features/sync/network', () => ({ useIsOnline: () => mockOnline }));
jest.mock('@/features/sync/dev-flags', () => ({ isForcedOffline: () => false }));
jest.mock('@/db/database', () => ({ getDatabase: async (owner: string) => owner }));
jest.mock('@/db/snapshots-repo', () => ({
  readSnapshot: async (db: string, key: string) => mockRead ? mockRead() : mockDisk.get(`${db}:${key}`) ?? null,
  writeSnapshot: async (db: string, key: string, value: Snapshot<string[]>) => { mockDisk.set(`${db}:${key}`, value); },
}));
function Probe({ resource = 'list' }: { resource?: string }) {
  const result = useSnapshotQuery('claims', resource, mockFetch);
  return <Text>{JSON.stringify({ data: result.data, cached: result.isCached, loading: result.isLoading, error: result.isError })}</Text>;
}
const clients: QueryClient[] = [];
function client() { const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(value); return value; }
function tree(cache: QueryClient, resource = 'list') { return <QueryClientProvider client={cache}><Probe resource={resource} /></QueryClientProvider>; }
beforeEach(() => { mockOwner = 'A'; mockOnline = true; mockRead = null; mockDisk.clear(); mockFetch.mockReset(); mockFetch.mockResolvedValue(['online']); });
afterEach(() => { clients.forEach((c) => c.clear()); clients.length = 0; });

test.each(['list', 'detail:claim-1', 'events:claim-1'])('online %s survives offline cold start and refreshes on reconnect', async (resource) => {
  const first = await render(tree(client(), resource));
  await waitFor(() => expect(first.getByText(/online/)).toBeTruthy());
  expect(mockDisk.get(`A:claims:${resource}`)?.data).toEqual(['online']);
  await first.unmount();
  mockOnline = false;
  const cache = client();
  const restarted = await render(tree(cache, resource));
  await waitFor(() => expect(restarted.getByText(/"cached":true/)).toBeTruthy());
  expect(restarted.getByText(/online/)).toBeTruthy();
  mockFetch.mockResolvedValue(['refreshed']);
  mockOnline = true;
  await restarted.rerender(tree(cache, resource));
  await waitFor(() => expect(restarted.getByText(/refreshed/)).toBeTruthy());
  expect(mockDisk.get(`A:claims:${resource}`)?.data).toEqual(['refreshed']);
  await restarted.unmount();
});

test('empty offline cache stops loading and exposes an error without calling the API', async () => {
  mockOnline = false;
  const view = await render(tree(client()));
  await waitFor(() => expect(view.getByText(/"loading":false,"error":true/)).toBeTruthy());
  expect(mockFetch).not.toHaveBeenCalled();
  await view.unmount();
});

test('account switch and logout never show A data; login as A recovers its disk snapshot', async () => {
  mockOnline = false;
  mockDisk.set('A:claims:list', { data: ['A-private'], fetchedAt: 1 });
  const cache = client();
  const view = await render(tree(cache));
  await waitFor(() => expect(view.getByText(/A-private/)).toBeTruthy());
  mockOwner = 'B';
  await view.rerender(tree(cache));
  await waitFor(() => expect(view.queryByText(/A-private/)).toBeNull());
  mockOwner = null;
  await view.rerender(tree(cache));
  expect(view.queryByText(/A-private/)).toBeNull();
  mockOwner = 'A';
  await view.rerender(tree(cache));
  await waitFor(() => expect(view.getByText(/A-private/)).toBeTruthy());
  await view.unmount();
});

test('slow hydration never replaces a newer in-memory response', async () => {
  let finish!: (snapshot: Snapshot<string[]>) => void;
  mockRead = () => new Promise((resolve) => { finish = resolve; });
  const cache = client();
  const view = await render(tree(cache));
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => {
    cache.setQueryData(['claims', 'A', 'list'], { data: ['newer'], fetchedAt: Date.now(), cached: false });
    finish({ data: ['older'], fetchedAt: 1 });
  });
  await waitFor(() => expect(view.queryByText(/older/)).toBeNull());
  expect(view.getByText(/newer|online/)).toBeTruthy();
  await view.unmount();
});


function PolicyProbe() {
  const result = useSnapshotQuery('policies', 'list', mockFetch, 15 * 60 * 1000);
  const [selected, setSelected] = useState('');
  return <><Text>{selected}</Text>{result.data?.map((policy) => <Pressable key={policy} onPress={() => setSelected(`Selected ${policy}`)}><Text>{policy}</Text></Pressable>)}</>;
}
test('expired policies remain selectable offline, reconnect refreshes; a fresh snapshot honors TTL', async () => {
  mockOnline = false;
  mockDisk.set('A:policies:list', { data: ['saved-policy'], fetchedAt: Date.now() - 16 * 60 * 1000 });
  const cache = client();
  const tree = <QueryClientProvider client={cache}><PolicyProbe /></QueryClientProvider>;
  const view = await render(tree);
  await waitFor(() => expect(view.getByText('saved-policy')).toBeTruthy());
  await fireEvent.press(view.getByText('saved-policy'));
  expect(view.getByText('Selected saved-policy')).toBeTruthy();
  mockOnline = true;
  mockFetch.mockResolvedValue(['current-policy']);
  await view.rerender(<QueryClientProvider client={cache}><PolicyProbe /></QueryClientProvider>);
  await waitFor(() => expect(view.getByText('current-policy')).toBeTruthy());
  await view.unmount();
  mockFetch.mockClear();
  const fresh = await render(<QueryClientProvider client={client()}><PolicyProbe /></QueryClientProvider>);
  await waitFor(() => expect(fresh.getByText('current-policy')).toBeTruthy());
  expect(mockFetch).not.toHaveBeenCalled();
  await fresh.unmount();
});
