import { capturePhoto } from './photo-capture';

let mockSize = 12;
let mockGranted = true;
let mockCanceled = false;
const mockCopy = jest.fn();
const mockDigest = jest.fn(async () => 'a'.repeat(64));
const mockCreate = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'attachment-id' }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: async () => ({ granted: mockGranted }),
  launchCameraAsync: async () => ({ canceled: mockCanceled, assets: [{ uri: 'file:///temporary/photo.jpg', mimeType: 'image/jpeg' }] }),
  launchImageLibraryAsync: async () => ({ canceled: mockCanceled, assets: [{ uri: 'file:///temporary/photo.jpg', mimeType: 'image/jpeg' }] }),
}));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  Directory: class {
    uri: string;
    exists = false;
    create = mockCreate;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
  },
  File: class {
    uri: string;
    name = 'photo.jpg';
    get size() { return mockSize; }
    digest = mockDigest;
    copy = mockCopy;
    constructor(first: string | { uri: string }, name?: string) { this.uri = typeof first === 'string' ? first : `${first.uri}/${name}`; }
  },
}));
beforeEach(() => { mockSize = 12; mockGranted = true; mockCanceled = false; mockCopy.mockReset(); mockDigest.mockClear(); mockCreate.mockClear(); });
test('copies evidence into the original draft document directory and records its checksum', async () => {
  const result = await capturePhoto('library', 'draft-1');
  expect(result?.localUri).toBe('file:///documents/claim-drafts/draft-1/photo-attachment-id.jpg');
  expect(result?.sha256).toBe('a'.repeat(64));
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
});
test('rejects oversize evidence before hashing or copying', async () => {
  mockSize = 10 * 1024 * 1024 + 1;
  await expect(capturePhoto('library', 'draft-1')).rejects.toThrow('10 MB');
  expect(mockDigest).not.toHaveBeenCalled();
  expect(mockCopy).not.toHaveBeenCalled();
});
test('denied camera permission gives a recoverable library alternative', async () => {
  mockGranted = false;
  await expect(capturePhoto('camera', 'draft-1')).rejects.toThrow('choose a photo');
  expect(mockCopy).not.toHaveBeenCalled();
});
test('canceling the picker adds no file', async () => {
  mockCanceled = true;
  expect(await capturePhoto('library', 'draft-1')).toBeNull();
  expect(mockCopy).not.toHaveBeenCalled();
});
