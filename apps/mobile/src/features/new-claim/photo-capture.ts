import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { ALLOWED_PHOTO_TYPES, validatePhoto } from './validate';

/** A photograph captured/copied into app document storage, ready to be declared to the API. */
export interface CapturedPhoto {
  attachmentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  localUri: string;
}

/**
 * Picks a photo from camera or gallery, validates it, copies it into durable app storage,
 * and computes the SHA-256 the API's document manifest requires. Returns null when the user
 * cancels, and throws a readable Error for size/type violations.
 */
export async function capturePhoto(source: 'camera' | 'library', draftId: string): Promise<CapturedPhoto | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Allow camera access in Settings or choose a photo from your library.');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled) return null;
  const asset = result.assets[0]!;

  const sourceFile = new File(asset.uri);
  const sizeBytes = sourceFile.size;
  const contentType = inferContentType(asset.mimeType, asset.fileName ?? sourceFile.name);

  const violation = validatePhoto(contentType, sizeBytes);
  if (violation) throw new Error(violation);
  const sha256 = await sourceFile.digest('SHA-256');

  const attachmentId = randomUUID();
  const fileName = `photo-${attachmentId}${extensionFor(contentType, asset.fileName ?? sourceFile.name)}`;

  const dir = new Directory(Paths.document, 'claim-drafts', draftId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, fileName);
  await sourceFile.copy(destination);

  return { attachmentId, fileName, contentType, sizeBytes, sha256, localUri: destination.uri };
}

function inferContentType(mimeType: string | null | undefined, fileName: string): string {
  const byMime = (ALLOWED_PHOTO_TYPES as readonly string[]).find((t) => t === mimeType);
  if (byMime) return byMime;
  switch (extension(fileName)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'heic':
      return 'image/heic';
    case 'png':
      return 'image/png';
    case 'pdf':
      return 'application/pdf';
    default:
      return mimeType ?? 'image/jpeg';
  }
}

function extensionFor(contentType: string, fileName: string): string {
  const ext = extension(fileName);
  if (ext) return `.${ext}`;
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/heic':
      return '.heic';
    case 'image/png':
      return '.png';
    case 'application/pdf':
      return '.pdf';
    default:
      return '.jpg';
  }
}

function extension(fileName: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(fileName);
  return match ? match[1]!.toLowerCase() : '';
}
