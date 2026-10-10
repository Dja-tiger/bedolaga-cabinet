import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { analyticsPath, configureMetrika, trackPage, trackGoal } from '../src/utils/metrika';
import { trackAnalyticsResponse } from '../src/utils/analyticsResponse';

afterEach(() => vi.unstubAllGlobals());

test('SPA tracking, event success guards, privacy, payment deduplication and disabled counter', async () => {
  const calls: unknown[][] = [];
  const storage = new Map<string, string>();
  const browserGlobals = {
    window: { ym: (...args: unknown[]) => calls.push(args) },
    document: {
      referrer: 'https://example.com/?token=secret',
      querySelector: () => true,
      head: { appendChild: () => {} },
      createElement: () => ({}),
    },
    location: {
      origin: 'https://cabinet.example',
      pathname: '/login',
      search: '?token=secret&utm_source=telegram',
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, v: string) => storage.set(key, v),
      removeItem: (key: string) => storage.delete(key),
    },
  };
  for (const [key, value] of Object.entries(browserGlobals)) vi.stubGlobal(key, value);
  vi.stubGlobal('crypto', webcrypto);
  const response = (url: string, data: unknown, method = 'post', status = 200) =>
    trackAnalyticsResponse({ status, config: { url, method }, data });
  trackGoal('early_event');
  configureMetrika('106533409');
  assert.equal(storage.get('ym_counter_id'), '106533409');
  trackPage('/login');
  trackPage('/login');
  assert.equal(calls.filter((c) => c[1] === 'hit').length, 1);
  assert.ok(calls.some((c) => c[2] === 'early_event'));
  assert.ok(calls.some((c) => c[1] === 'hit' && String(c[2]).includes('utm_source=telegram')));
  assert.ok(!JSON.stringify(calls).includes('secret'));
  assert.equal(analyticsPath('/buy/success/private-token'), '/buy/success/_purchase');
  assert.equal(analyticsPath('/buy/gift/private-gift-token'), '/buy/gift/_gift');
  assert.equal(analyticsPath('/subscriptions/42/renew'), '/subscriptions/_item/renew');
  assert.equal(analyticsPath('/admin/users/42'), null);
  trackPage('/admin/users/42');
  assert.equal(calls.filter((c) => c[1] === 'hit').length, 1);
  response('/cabinet/auth/email/login', {
    access_token: 'private',
    refresh_token: 'private',
    user: { email: 'private@example.com' },
  });
  response('/cabinet/auth/refresh', {
    access_token: 'private',
    refresh_token: 'private',
    user: {},
  });
  response('/cabinet/auth/email/login', { access_token: 'private' }, 'post', 401);
  assert.equal(calls.filter((c) => c[2] === 'login_success').length, 1);
  response('/cabinet/subscription/purchase', { success: false });
  response('/cabinet/subscription/purchase', { success: true, was_trial_conversion: true });
  assert.equal(calls.filter((c) => c[2] === 'subscription_purchased').length, 1);
  assert.equal(calls.filter((c) => c[2] === 'trial_converted').length, 1);
  response(
    '/cabinet/balance/pending-payments/card/12',
    { id: 12, method: 'card', status: 'pending' },
    'get',
  );
  response(
    '/cabinet/balance/pending-payments/card/12',
    { id: 12, method: 'card', status: 'paid' },
    'get',
  );
  response(
    '/cabinet/balance/pending-payments/card/12',
    { id: 12, method: 'card', status: 'paid' },
    'get',
  );
  response('/cabinet/landing/purchase/private-token', { status: 'paid' }, 'get');
  response('/cabinet/landing/activate/private-token', { status: 'delivered' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls.filter((c) => c[2] === 'topup_paid').length, 1);
  assert.equal(calls.filter((c) => c[2] === 'quick_purchase_paid').length, 1);
  assert.ok(!JSON.stringify(calls).includes('private'));
  assert.ok(![...storage.values()].join('').includes('private-token'));
  const before = calls.length;
  configureMetrika('');
  assert.equal(storage.has('ym_counter_id'), false);
  trackGoal('must_not_send');
  trackPage('/');
  assert.equal(calls.length, before + 1); // destruct only
});
