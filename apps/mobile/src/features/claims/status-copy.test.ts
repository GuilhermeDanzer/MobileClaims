import { deviceStateCopy, documentStatusCopy, scanStatusCopy, serverStatusCopy } from './status-copy';

describe('deviceStateCopy', () => {
  test.each([
    ['draft', 'Saved on this device'],
    ['queued', 'Waiting to send'],
    ['submitting', 'Sending claim'],
    ['needs_attention', 'Needs your attention'],
  ] as const)('%s → "%s"', (state, title) => {
    expect(deviceStateCopy(state).title).toBe(title);
  });

  test('only shows "Submitted" for accepted/media_pending/complete, with the reference', () => {
    expect(deviceStateCopy('accepted', 'NW-2026-000001').title).toBe('Submitted · NW-2026-000001');
    expect(deviceStateCopy('media_pending', 'NW-2026-000001').title).toBe('Submitted · NW-2026-000001');
    expect(deviceStateCopy('complete', 'NW-2026-000001').title).toBe('Submitted · NW-2026-000001');
  });

  test('never says "Submitted" before server confirmation', () => {
    expect(deviceStateCopy('queued').title).not.toContain('Submitted');
    expect(deviceStateCopy('submitting').title).not.toContain('Submitted');
    expect(deviceStateCopy('draft').title).not.toContain('Submitted');
  });
});

describe('serverStatusCopy', () => {
  test('maps intake statuses to customer copy', () => {
    expect(serverStatusCopy('received', null).title).toBe('Received');
    expect(serverStatusCopy('legacy_accepted', null).title).toBe('With the claims team');
    expect(serverStatusCopy('legacy_rejected', null).title).toBe('Action needed');
  });

  test('prefers the latest legacy status over intake', () => {
    expect(serverStatusCopy('legacy_accepted', 'under_review').title).toBe('Under review');
    expect(serverStatusCopy('legacy_accepted', 'approved').title).toBe('Approved');
  });

  test('handles unknown future statuses gracefully without crashing', () => {
    const unknown = serverStatusCopy('some_future_intake', 'some_future_legacy');
    expect(unknown.title).toBe('some_future_legacy');
    expect(unknown.detail).toBe('');

    const unknownIntakeOnly = serverStatusCopy('some_future_intake', null);
    expect(unknownIntakeOnly.title).toBe('some_future_intake');
  });
});

describe('document/scan status copy', () => {
  test('maps known statuses and tolerates unknown ones', () => {
    expect(documentStatusCopy('complete')).toBe('Received');
    expect(documentStatusCopy('some_future_state')).toBe('some_future_state');
    expect(scanStatusCopy('not_scanned')).toBe('Not scanned');
    expect(scanStatusCopy('some_future_scan')).toBe('some_future_scan');
  });
});

test('server acceptance with pending media never implies delivery readiness', () => {
  expect(serverStatusCopy('media_pending', 'received').title).toBe('Received · photos pending');
  expect(deviceStateCopy('media_pending').detail).toBe('Photos still uploading');
});
