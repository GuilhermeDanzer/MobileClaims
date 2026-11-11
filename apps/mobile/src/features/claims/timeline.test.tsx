import type { ClaimStatusEvent } from '@northwind/contracts';
import { render } from '@testing-library/react-native';

import { StatusTimeline } from './timeline';

const events: ClaimStatusEvent[] = [
  { at: '2026-11-05T10:00:00.000Z', status: 'received', label: 'Claim received', source: 'platform' },
  { at: '2026-11-05T10:05:00.000Z', status: 'under_review', label: 'Under review', source: 'legacy' },
];

test('renders each event label with its source', async () => {
  const { getByText } = await render(<StatusTimeline events={events} />);
  expect(getByText('Claim received')).toBeTruthy();
  expect(getByText('Under review')).toBeTruthy();
  expect(getByText(/Claims team/)).toBeTruthy();
});

test('renders an unknown future status label verbatim without crashing', async () => {
  const unknown: ClaimStatusEvent[] = [
    { at: '2026-11-05T10:00:00.000Z', status: 'future_status_xyz', label: 'Something new', source: 'legacy' },
  ];
  const { getByText } = await render(<StatusTimeline events={unknown} />);
  expect(getByText('Something new')).toBeTruthy();
});

test('shows a placeholder for an empty timeline', async () => {
  const { getByText } = await render(<StatusTimeline events={[]} />);
  expect(getByText('No status updates yet.')).toBeTruthy();
});
