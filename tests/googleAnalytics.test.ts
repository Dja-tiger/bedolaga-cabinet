import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const ID = 'G-JLDW8X4W2B';
let calls: unknown[][];
let scripts: { src: string }[];
let storage: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  calls = [];
  scripts = [];
  storage = new Map();
  vi.stubGlobal('window', { gtag: (...args: unknown[]) => calls.push(args) });
  vi.stubGlobal('document', {
    referrer: 'https://example.com/buy/success/private-referrer?email=private@example.com',
    querySelector: () => scripts[0] ?? null,
    createElement: () => ({}),
    head: { appendChild: (script: { src: string }) => scripts.push(script) },
  });
  vi.stubGlobal('location', {
    origin: 'https://cabinet.example',
    pathname: '/login',
    search: '?token=private-token&utm_source=telegram',
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

const events = (name: string) => calls.filter((c) => c[0] === 'event' && c[1] === name);

test('GA4 and Ads share one tag; business events target only GA4 and URLs are masked', async () => {
  const ga = await import('../src/utils/googleAnalytics');
  ga.trackGoogleGoal('early_event');
  ga.configureGoogleAnalytics(ID, 'AW-123456789');
  ga.trackGooglePage('/login');
  ga.configureGoogleAnalytics(ID, 'AW-123456789');
  ga.trackGooglePage('/login');
  ga.trackGoogleGoal('subscription_purchased');
  assert.equal(scripts.length, 1);
  assert.equal(calls.filter((c) => c[0] === 'config').length, 2);
  assert.equal(
    (calls.find((c) => c[0] === 'config' && c[1] === ID)?.[2] as Record<string, unknown>)
      .send_page_view,
    false,
  );
  assert.equal(events('page_view').length, 1);
  assert.equal(events('early_event').length, 1);
  assert.ok(
    events('subscription_purchased').every((c) => (c[2] as Record<string, unknown>).send_to === ID),
  );
  assert.ok(!JSON.stringify(calls).includes('private'));
  assert.ok(JSON.stringify(calls).includes('utm_source=telegram'));
});

test('GA4 alone records successful purchases and renewals using the existing response contract', async () => {
  const { configureMetrika } = await import('../src/utils/metrika');
  const ga = await import('../src/utils/googleAnalytics');
  const { trackAnalyticsResponse } = await import('../src/utils/analyticsResponse');
  configureMetrika('');
  ga.configureGoogleAnalytics(ID);
  ga.trackGooglePage('/subscription/purchase');
  const response = (request: unknown, data: unknown, status = 200) =>
    trackAnalyticsResponse({
      status,
      config: { url: '/cabinet/subscription/purchase-tariff', method: 'post', data: request },
      data,
    });
  response({ tariff_id: 7 }, { success: true });
  response(JSON.stringify({ tariff_id: 7, subscription_id: 42 }), { success: true });
  response({ subscription_id: 42 }, { success: true, was_trial_conversion: true });
  response({}, { success: false });
  response({}, { success: true }, 500);
  assert.equal(events('subscription_purchased').length, 2);
  assert.equal(events('subscription_renewed').length, 1);
  assert.equal(events('trial_converted').length, 1);
  assert.ok(!JSON.stringify(calls).includes('subscription_id'));
});

test('masked routes count distinct visits, exclude admin and count the return visit', async () => {
  const ga = await import('../src/utils/googleAnalytics');
  ga.configureGoogleAnalytics(ID);
  for (const path of [
    '/subscriptions/42',
    '/subscriptions/43',
    '/subscriptions/43',
    '/buy/secret-a',
    '/buy/secret-b',
    '/admin/users/1',
    '/buy/secret-b',
  ])
    ga.trackGooglePage(path);
  assert.equal(events('page_view').length, 5);
  assert.equal(events('quick_purchase_view').length, 3);
  assert.ok(!JSON.stringify(calls).includes('secret'));
  assert.ok(!JSON.stringify(calls).includes('/admin'));
  ga.trackGooglePage('/admin/users/1');
  ga.trackGoogleGoal('admin_event');
  assert.equal(events('admin_event').length, 0);
});

test('payment polling and activation count once per GA4 property, including across reloads', async () => {
  let ga = await import('../src/utils/googleAnalytics');
  ga.configureGoogleAnalytics(ID);
  ga.trackGooglePage('/buy/success/private-payment');
  await Promise.all([
    ga.trackGoogleGoalOnce('quick_purchase_paid', 'private-payment'),
    ga.trackGoogleGoalOnce('quick_purchase_paid', 'private-payment'),
  ]);
  vi.resetModules();
  ga = await import('../src/utils/googleAnalytics');
  ga.configureGoogleAnalytics(ID);
  ga.trackGooglePage('/buy/success/private-payment');
  await ga.trackGoogleGoalOnce('quick_purchase_paid', 'private-payment');
  assert.equal(events('quick_purchase_paid').length, 1);
  ga.configureGoogleAnalytics('G-OTHER12345');
  ga.trackGooglePage('/');
  await ga.trackGoogleGoalOnce('quick_purchase_paid', 'private-payment');
  assert.equal(events('quick_purchase_paid').length, 2);
  assert.ok(!JSON.stringify(calls).includes('private-payment'));
  assert.ok(![...storage.values()].join('').includes('private-payment'));
});

test('Ads-only configuration, disabling and switching GA4 do not send events to an old destination', async () => {
  const ga = await import('../src/utils/googleAnalytics');
  ga.configureGoogleAnalytics('', 'AW-123456789');
  ga.trackGooglePage('/');
  ga.trackGoogleGoal('no_ga');
  assert.equal(events('page_view').length, 0);
  ga.configureGoogleAnalytics(ID, 'AW-123456789');
  ga.trackGooglePage('/');
  ga.configureGoogleAnalytics('', 'AW-123456789');
  const before = calls.length;
  ga.trackGooglePage('/balance');
  ga.trackGoogleGoal('disabled');
  assert.equal(calls.length, before);
  assert.equal((window as unknown as Record<string, unknown>)[`ga-disable-${ID}`], true);
  ga.configureGoogleAnalytics('G-OTHER12345', 'AW-123456789');
  ga.trackGooglePage('/balance');
  assert.equal(
    (events('page_view').at(-1)?.[2] as Record<string, unknown>).send_to,
    'G-OTHER12345',
  );
  assert.equal(scripts.length, 1);
});

test('blocked Google tag does not prevent Yandex business events', async () => {
  const ga = await import('../src/utils/googleAnalytics');
  ga.configureGoogleAnalytics(ID);
  ga.trackGooglePage('/');
  const ymCalls: unknown[][] = [];
  (window as unknown as Record<string, unknown>).ym = (...args: unknown[]) => ymCalls.push(args);
  const ym = await import('../src/utils/metrika');
  ym.configureMetrika('106533409');
  ym.trackPage('/');
  (window as unknown as Record<string, unknown>).gtag = () => {
    throw new Error('Blocked');
  };
  const { trackGoal } = await import('../src/utils/analytics');
  assert.doesNotThrow(() => trackGoal('subscription_renewed'));
  assert.ok(ymCalls.some((c) => c[1] === 'reachGoal' && c[2] === 'subscription_renewed'));
});

test('standard gtag queue is initialized before loading the external script', async () => {
  vi.stubGlobal('window', {});
  const ga = await import('../src/utils/googleAnalytics');
  ga.configureGoogleAnalytics(ID);
  ga.trackGooglePage('/');
  const dataLayer = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer;
  assert.equal(dataLayer[0][0], 'js');
  assert.equal(dataLayer[1][0], 'config');
  assert.ok(dataLayer.some((c) => c[0] === 'event' && c[1] === 'page_view'));
  assert.equal(scripts.length, 1);
});
