import type { DeviceSubmissionState } from '@northwind/contracts';

/**
 * The single place that turns a machine status into customer-facing copy. No screen may
 * invent its own wording — this mapping (and its tests) is the contract.
 *
 * Two axes exist:
 * - device submission state (the offline outbox lifecycle), and
 * - server status (intake + latest legacy status) for claims the platform is tracking.
 * Unknown statuses are rendered safely rather than crashing or lying.
 */

export interface StatusCopy {
  title: string;
  detail: string;
}

export function deviceStateCopy(state: DeviceSubmissionState, reference: string | null = null): StatusCopy {
  switch (state) {
    case 'draft':
      return { title: 'Saved on this device', detail: 'Not yet submitted' };
    case 'queued':
      return { title: 'Waiting to send', detail: 'Retries automatically' };
    case 'submitting':
      return { title: 'Sending claim', detail: 'Waiting for confirmation from the platform' };
    case 'accepted':
      return { title: reference ? `Submitted · ${reference}` : 'Submitted', detail: 'Received by the platform' };
    case 'media_pending':
      return { title: reference ? `Submitted · ${reference}` : 'Submitted', detail: 'Photos still uploading' };
    case 'complete':
      return { title: reference ? `Submitted · ${reference}` : 'Submitted', detail: 'All documents received' };
    case 'needs_attention':
      return { title: 'Needs your attention', detail: reference ? `Claim accepted · ${reference}. Evidence needs attention.` : 'Your draft is saved. Open it to review and try again.' };
  }
}

const LEGACY_COPY: Record<string, StatusCopy> = {
  under_review: { title: 'Under review', detail: 'The claims team is assessing it' },
  info_requested: { title: 'More information requested', detail: 'The claims team will contact you' },
  adjuster_assigned: { title: 'Adjuster assigned', detail: 'An adjuster is working on your claim' },
  approved: { title: 'Approved', detail: 'Your claim has been approved' },
  denied: { title: 'Not approved', detail: 'Your claim was not approved' },
  payment_issued: { title: 'Payment issued', detail: 'A payment has been issued' },
  closed: { title: 'Closed', detail: 'This claim is closed' },
};

const INTAKE_COPY: Record<string, StatusCopy> = {
  media_pending: { title: 'Received · photos pending', detail: 'Claim accepted; evidence still uploading' },
  received: { title: 'Received', detail: 'Sending to the claims team' },
  queued_for_legacy: { title: 'Received', detail: 'Sending to the claims team' },
  sent_to_legacy: { title: 'Received', detail: 'Sending to the claims team' },
  legacy_accepted: { title: 'With the claims team', detail: 'Processing has started' },
  legacy_rejected: { title: 'Action needed', detail: 'Please contact support' },
  needs_review: { title: 'Needs review', detail: 'The claims team is looking into it' },
};

export function serverStatusCopy(intakeStatus: string, latestStatus: string | null): StatusCopy {
  // The latest legacy status is the most meaningful; fall back to intake, then to the raw value.
  if (latestStatus && LEGACY_COPY[latestStatus]) return LEGACY_COPY[latestStatus]!;
  if (INTAKE_COPY[intakeStatus]) return INTAKE_COPY[intakeStatus]!;
  return { title: latestStatus ?? intakeStatus, detail: '' };
}

const DOCUMENT_STATUS_COPY: Record<string, string> = {
  pending_upload: 'Waiting for upload',
  uploaded: 'Uploaded',
  complete: 'Received',
};

const SCAN_STATUS_COPY: Record<string, string> = {
  not_scanned: 'Not scanned',
  clean: 'Scanned — no issues',
};

export function documentStatusCopy(status: string): string {
  return DOCUMENT_STATUS_COPY[status] ?? status;
}

export function scanStatusCopy(scanStatus: string): string {
  return SCAN_STATUS_COPY[scanStatus] ?? scanStatus;
}
