import { uploadToPresignedUrl } from './upload';

let mockExists = true;
let mockStatus = 200;
let mockHang = false;
jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 'binary' },
  File: class {
    get exists() { return mockExists; }
    async upload(_url: string, options: { signal?: AbortSignal; onProgress?: (value: { bytesSent: bigint; totalBytes: bigint }) => void }) {
      if (mockHang) {
        return await new Promise<{ status: number }>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('stalled')), { once: true });
        });
      }
      options.onProgress?.({ bytesSent: BigInt(5), totalBytes: BigInt(10) });
      return { status: mockStatus };
    }
  },
}));
beforeEach(() => { mockExists = true; mockStatus = 200; mockHang = false; });
test('normalizes native bigint byte counters before they reach React percentage calculations', async () => {
  const progress = jest.fn();
  await uploadToPresignedUrl({ localUri: 'file:///documents/a.jpg', contentType: 'image/jpeg' }, 'https://local-store/upload', progress);
  expect(progress).toHaveBeenCalledWith(5, 10);
  const [sent, total] = progress.mock.calls[0]!;
  expect(Math.round(sent / total * 100)).toBe(50);
});
test('a missing durable file is a permanent actionable failure', async () => {
  mockExists = false;
  await expect(uploadToPresignedUrl({ localUri: 'missing', contentType: 'image/jpeg' }, 'url')).rejects.toMatchObject({ kind: 'permanent', message: expect.stringContaining('missing') });
});
test('storage errors explain recovery without exposing HTTP jargon', async () => {
  mockStatus = 403;
  await expect(uploadToPresignedUrl({ localUri: 'file:///documents/a.jpg', contentType: 'image/jpeg' }, 'url')).rejects.toThrow('retry with a fresh upload link');
});


test('a stalled native upload is aborted and returns to the durable retry path', async () => {
  jest.useFakeTimers();
  try {
    mockHang = true;
    const failure = expect(uploadToPresignedUrl({ localUri: 'file:///documents/a.jpg', contentType: 'image/jpeg' }, 'url')).rejects.toThrow('retry with a fresh upload link');
    await jest.advanceTimersByTimeAsync(60_000);
    await failure;
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
