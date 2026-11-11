/**
 * Shared claim-status vocabulary.
 *
 * These values are the contract between the mobile app and the API. They must only change
 * additively, and the mobile parser must tolerate unknown values (see MOBILE_OFFLINE.md).
 */

/** Customer-visible state of a submission on the device (outbox state machine). */
export const deviceSubmissionStates = [
  'draft',
  'queued',
  'submitting',
  'accepted',
  'media_pending',
  'complete',
  'needs_attention',
] as const;
export type DeviceSubmissionState = (typeof deviceSubmissionStates)[number];

/** Intake lifecycle, tracked server-side and mirrored into the timeline. */
export const intakeStatuses = [
  'received',
  'queued_for_legacy',
  'sent_to_legacy',
  'legacy_accepted',
  'legacy_rejected',
  'needs_review',
] as const;
export type IntakeStatus = (typeof intakeStatuses)[number];

/** Post-intake statuses mirrored from the legacy system. Unknown values are allowed. */
export const legacyStatuses = [
  'under_review',
  'info_requested',
  'adjuster_assigned',
  'approved',
  'denied',
  'payment_issued',
  'closed',
] as const;
export type LegacyStatus = (typeof legacyStatuses)[number];

/** A claim-status event as it appears in the timeline. */
export interface ClaimStatusEvent {
  /** Deliberately open: unknown legacy values must not crash the app. */
  status: string;
  label: string;
  /** ISO-8601 UTC. */
  at: string;
  source: 'platform' | 'legacy';
}

/** A document's upload state, tracked by the platform. */
export const documentStatuses = ['pending_upload', 'uploaded', 'complete'] as const;
export type DocumentStatus = (typeof documentStatuses)[number];
