import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
const trackGoal = vi.fn();
vi.mock('../src/utils/analytics', () => ({ trackGoal }));
beforeEach(() => trackGoal.mockClear());

test('connection interactions record app/platform categories without private links', async () => {
  const { trackConnectionAction } = await import('../src/utils/analyticsInteraction');
  trackConnectionAction('import_clicked', 'macos', 'INCY');
  assert.deepEqual(trackGoal.mock.calls[0], [
    'connection_import_clicked',
    {
      connection_platform: 'macos',
      connection_app: 'incy',
    },
  ]);
  trackConnectionAction('app_selected', 'https://private-token', 'private@example.com');
  assert.deepEqual(trackGoal.mock.calls[1], [
    'connection_app_selected',
    {
      connection_platform: 'other',
      connection_app: 'other',
    },
  ]);
});

test('payment-link clicks remain separate from confirmed payment events', async () => {
  const { trackPaymentLinkAction } = await import('../src/utils/analyticsInteraction');
  trackPaymentLinkAction('ready');
  trackPaymentLinkAction('opened');
  trackPaymentLinkAction('copied');
  assert.deepEqual(trackGoal.mock.calls, [
    ['payment_link_ready'],
    ['payment_link_opened'],
    ['payment_link_copied'],
  ]);
});
