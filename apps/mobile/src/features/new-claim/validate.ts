import { isValidDate } from '@/lib/format';

/**
 * Client-side validation for a new claim, including calendar and future-date checks.
 * The server remains authoritative at submission; these checks provide immediate feedback.
 */

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS = 10;
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/heic', 'image/png', 'application/pdf'] as const;

export interface DraftFields {
  policyNumber: string | null;
  incidentDescription: string;
  incidentDate: string;
}

export interface DraftValidation {
  errors: { policyNumber?: string; incidentDescription?: string; incidentDate?: string };
  valid: boolean;
}

export function validateDraft(fields: DraftFields): DraftValidation {
  const errors: DraftValidation['errors'] = {};

  if (!fields.policyNumber) errors.policyNumber = 'Select a policy';

  const description = fields.incidentDescription.trim();
  if (description.length === 0) {
    errors.incidentDescription = 'Describe what happened';
  } else if (description.length > 2000) {
    errors.incidentDescription = 'Keep the description under 2000 characters';
  }

  if (!isValidDate(fields.incidentDate)) {
    errors.incidentDate = 'Enter a valid date (MM/DD/YYYY)';
  } else {
    // Compare calendar dates in the device's local timezone, not UTC.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (fields.incidentDate > today) {
      errors.incidentDate = 'Incident date cannot be in the future';
    }
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}

/** Returns a readable reason, or null when the photo is acceptable. */
export function validatePhoto(contentType: string, sizeBytes: number): string | null {
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(contentType)) {
    return 'Only JPEG, HEIC, PNG or PDF files are supported';
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return 'This file is empty or unavailable. Choose another file';
  if (sizeBytes > MAX_PHOTO_BYTES) return 'Files must be 10 MB or smaller';
  return null;
}
