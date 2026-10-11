import { describe, expect, it } from 'vitest';
import type { AppConfig, RemnawaveAppClient } from '../src/types';
import { INCY_APP_STORE_URL, withIncyApps } from '../src/utils/connectionApps';
import { resolveAppDeepLinkForUi } from '../src/utils/connectionLink';

const subscriptionUrl = 'https://example.com/subscription/test?format=auto';
const happCryptLink = 'happ://crypt4/test-payload';
const app = (name: string): RemnawaveAppClient => ({ name, blocks: [] });

function config(): AppConfig {
  return {
    platformNames: { ios: { en: 'iPhone / iPad' }, macos: { en: 'Mac' } },
    hasSubscription: true,
    subscriptionUrl,
    hideLink: true,
    platforms: {
      ios: { svgIconKey: 'apple', apps: [{ ...app('Happ'), featured: true }, app('Shadowrocket')] },
      macos: { displayName: { en: 'Mac' }, apps: [app('Happ')] },
      android: { apps: [app('Happ')] },
      appleTV: { apps: [app('Happ')] },
    },
  };
}

describe('INCY installation choices', () => {
  it('puts INCY first and selects it by default on iOS and Mac without mutating panel settings', () => {
    const original = config();
    const before = JSON.stringify(original);
    const updated = withIncyApps(original);

    for (const platform of ['ios', 'macos']) {
      const apps = updated.platforms[platform].apps;
      expect(apps.map((item) => item.name)).toEqual([
        'INCY',
        ...original.platforms[platform].apps.map((item) => item.name),
      ]);
      expect(apps.find((item) => item.featured)?.name).toBe('INCY');
      expect(apps.slice(1)).toEqual(original.platforms[platform].apps);
    }
    expect(updated.platforms.ios.svgIconKey).toBe('apple');
    expect(updated.platforms.macos.displayName).toEqual({ en: 'Mac' });
    expect(updated.platforms.android).toBe(original.platforms.android);
    expect(updated.platforms.appleTV).toBe(original.platforms.appleTV);
    expect(updated.hideLink).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('uses the supplied App Store link and imports the selected subscription into INCY', () => {
    const updated = withIncyApps(config());
    for (const platform of ['ios', 'macos']) {
      const incy = updated.platforms[platform].apps[0];
      expect(incy.blocks[0].buttons?.[0].url).toBe(INCY_APP_STORE_URL);
      expect(INCY_APP_STORE_URL).toBe('https://apps.apple.com/ru/app/incy/id6756943388?l=ru');
      expect(incy.deepLink).toBe(`incy://import/${subscriptionUrl}`);
      expect(incy.blocks[1].buttons?.[0]).toMatchObject({
        type: 'subscriptionLink',
        url: incy.deepLink,
      });
    }
  });

  it.each([
    { ...app('Incy'), deepLink: 'incy://import/custom' },
    { ...app('Custom Apple client'), deepLink: 'incy://import/custom' },
    {
      ...app('Custom Apple client'),
      blocks: [
        {
          title: { en: 'Custom instructions' },
          description: { en: 'Keep panel instructions' },
          buttons: [{ link: INCY_APP_STORE_URL, text: { en: 'Install' } }],
        },
      ],
    },
  ])('reuses existing INCY configuration and instructions: $name', (existing) => {
    const original = config();
    original.platforms.ios.apps.push(existing);
    const updated = withIncyApps(original);
    expect(updated.platforms.ios.apps).toHaveLength(original.platforms.ios.apps.length);
    expect(updated.platforms.ios.apps[0]).toEqual({ ...existing, featured: true });
    expect(updated.platforms.ios.apps[0].blocks).toBe(existing.blocks);
  });

  it('adds missing Apple platform choices and remains idempotent', () => {
    const original = config();
    delete original.platforms.ios;
    delete original.platforms.macos;
    const updated = withIncyApps(original);
    expect(updated.platforms.ios.apps.map((item) => item.name)).toEqual(['INCY']);
    expect(updated.platforms.macos.apps.map((item) => item.name)).toEqual(['INCY']);
    expect(withIncyApps(updated)).toEqual(updated);
  });

  it.each([null, 'happ://crypt4/test-payload'])(
    'keeps installation available without an importable subscription: %s',
    (url) => {
      const original = config();
      original.subscriptionUrl = url;
      const incy = withIncyApps(original).platforms.ios.apps[0];
      expect(incy.blocks[0].buttons?.[0].url).toBe(INCY_APP_STORE_URL);
      expect(incy.deepLink).toBeNull();
      expect(incy.blocks[1].buttons).toEqual([]);
    },
  );
});

describe('app-specific imports in Happ cryptolink mode', () => {
  it.each([`incy://import/${subscriptionUrl}`, `streisand://import/${subscriptionUrl}`])(
    'keeps another app scheme instead of opening Happ: %s',
    (deepLink) => {
      expect(resolveAppDeepLinkForUi(deepLink, 'HAPP_CRYPTOLINK', happCryptLink)).toBe(deepLink);
    },
  );

  it('still opens the encrypted link for Happ and preserves plain mode and missing-link fallback', () => {
    const deepLink = `happ://add/${subscriptionUrl}`;
    expect(resolveAppDeepLinkForUi(deepLink, 'HAPP_CRYPTOLINK', happCryptLink)).toBe(happCryptLink);
    expect(resolveAppDeepLinkForUi(deepLink, 'PLAIN', happCryptLink)).toBe(deepLink);
    expect(resolveAppDeepLinkForUi(deepLink, 'HAPP_CRYPTOLINK', null)).toBe(deepLink);
  });
});
