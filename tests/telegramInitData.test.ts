import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const retrieveRawInitData = vi.hoisted(() => vi.fn<() => string | undefined>());

vi.mock('@telegram-apps/sdk-react', () => ({
  retrieveRawInitData,
  retrieveLaunchParams: () => ({ tgWebAppPlatform: 'ios' }),
}));

import { getTelegramInitData, needsTelegramAuthRecovery } from '../src/utils/telegramInitData';
import { getTelegramInitData as getLoginInitData } from '../src/hooks/useTelegramSDK';
import { clearStaleSessionIfNeeded, tokenStorage } from '../src/utils/token';
import { authApi } from '../src/api/auth';
import { apiClient } from '../src/api/client';

function initData(authDate: number, userId = 1): string {
  const user = encodeURIComponent(JSON.stringify({ id: userId, first_name: 'A' }));
  return `user=${user}&auth_date=${authDate}&signature=s&hash=h${authDate}`;
}

const OLD = initData(1_700_000_000, 2);
const FRESH = initData(1_780_000_000, 2);

function setBridge(value?: string): void {
  vi.stubGlobal('window', value === undefined ? {} : { Telegram: { WebApp: { initData: value } } });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

beforeEach(() => {
  retrieveRawInitData.mockReset();
  setBridge();
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('document', { cookie: 'csrf_token=test-csrf' });
  tokenStorage.clearTokens();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fresh Telegram init data', () => {
  it('rejects a late authenticated API response after switching sessions', async () => {
    let reply!: () => void;
    const adapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = (config) =>
      new Promise((resolve) => {
        reply = () =>
          resolve({
            data: { oldAccount: true },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          });
      });
    tokenStorage.setTokens('old-access', 'old-refresh');
    // Use a structurally valid access token to avoid invoking refresh in this test.
    tokenStorage.setAccessToken(
      `e30.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.test`,
    );
    const pending = apiClient.get('/cabinet/auth/me').catch((error: unknown) => error);
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    tokenStorage.setTokens('new-access', 'new-refresh');
    reply();
    try {
      expect(axios.isCancel(await pending)).toBe(true);
    } finally {
      apiClient.defaults.adapter = adapter;
    }
  });
  it('does not select a cached SDK launch from another account', () => {
    setBridge(OLD);
    retrieveRawInitData.mockReturnValue(initData(1_780_000_000, 99));
    expect(getTelegramInitData()).toBe(OLD);
  });
  it('uses the bridge when the SDK returns an old cached launch', () => {
    setBridge(FRESH);
    retrieveRawInitData.mockReturnValue(OLD);

    expect(getTelegramInitData()).toBe(FRESH);
    expect(getLoginInitData()).toBe(FRESH);
  });

  it('uses the SDK when the bridge itself is older', () => {
    setBridge(OLD);
    retrieveRawInitData.mockReturnValue(FRESH);

    expect(getTelegramInitData()).toBe(FRESH);
  });

  it('prefers the bridge when dates are equal', () => {
    const bridge = `${FRESH}&query_id=bridge`;
    setBridge(bridge);
    retrieveRawInitData.mockReturnValue(FRESH);

    expect(getTelegramInitData()).toBe(bridge);
  });

  it.each([undefined, ''])('falls back to the SDK when bridge data is %s', (bridge) => {
    setBridge(bridge);
    retrieveRawInitData.mockReturnValue(FRESH);

    expect(getTelegramInitData()).toBe(FRESH);
  });

  it('keeps bridge data when the SDK throws', () => {
    setBridge(FRESH);
    retrieveRawInitData.mockImplementation(() => {
      throw new Error('LaunchParamsRetrieveError');
    });

    expect(getTelegramInitData()).toBe(FRESH);
  });

  it('returns null outside Telegram when no source is available', () => {
    retrieveRawInitData.mockImplementation(() => {
      throw new Error('LaunchParamsRetrieveError');
    });

    expect(getTelegramInitData()).toBeNull();
  });

  it('does not read the SDK without a browser window', () => {
    vi.stubGlobal('window', undefined);

    expect(getTelegramInitData()).toBeNull();
    expect(retrieveRawInitData).not.toHaveBeenCalled();
  });

  it.each(['hash=h', 'auth_date=invalid', 'auth_date=Infinity', 'auth_date='])(
    'does not prefer a bridge timestamp that cannot be parsed: %s',
    (bridge) => {
      setBridge(bridge);
      retrieveRawInitData.mockReturnValue(FRESH);

      expect(getTelegramInitData()).toBe(FRESH);
    },
  );

  it('prefers the bridge when neither date can be parsed', () => {
    setBridge('hash=bridge');
    retrieveRawInitData.mockReturnValue('auth_date=invalid&hash=sdk');

    expect(getTelegramInitData()).toBe('hash=bridge');
  });

  it('reads the sources again after a new launch', () => {
    setBridge(OLD);
    retrieveRawInitData.mockReturnValue(OLD);
    expect(getTelegramInitData()).toBe(OLD);

    setBridge(FRESH);
    expect(getTelegramInitData()).toBe(FRESH);
  });

  it('preserves the exact encoded payload, hash and signature', () => {
    const bridge = `${FRESH}&query_id=a%2Bb%3D&extra=%2f%20`;
    setBridge(bridge);
    retrieveRawInitData.mockReturnValue(OLD);

    expect(getTelegramInitData()).toBe(bridge);
  });
});

describe('authentication consumers', () => {
  const originalAdapter = apiClient.defaults.adapter;

  afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
  });

  function captureRequests() {
    const adapter = vi.fn(async (config) => ({
      config,
      data: { access_token: 'test-access', refresh_token: 'test-refresh' },
      headers: {},
      status: 200,
      statusText: 'OK',
    }));
    apiClient.defaults.adapter = adapter;
    return adapter;
  }

  it('sends fresh data in both the login body and header, replacing the old app cache', async () => {
    setBridge(FRESH);
    retrieveRawInitData.mockReturnValue(OLD);
    tokenStorage.setTelegramInitData(OLD);
    const adapter = captureRequests();

    await authApi.loginTelegram(getLoginInitData()!, 'campaign', 'referral');

    const config = adapter.mock.calls[0][0];
    expect(config.url).toBe('/cabinet/auth/telegram');
    expect(config.headers.get('X-Telegram-Init-Data')).toBe(FRESH);
    expect(JSON.parse(config.data)).toMatchObject({
      init_data: FRESH,
      campaign_slug: 'campaign',
      referral_code: 'referral',
    });
    expect(tokenStorage.getTelegramInitData()).toBe(FRESH);
  });

  it('uses fresh data for linking a Telegram account too', async () => {
    setBridge(FRESH);
    retrieveRawInitData.mockReturnValue(OLD);
    const adapter = captureRequests();

    await apiClient.post('/cabinet/auth/account/link/telegram', {
      init_data: getLoginInitData(),
    });

    const config = adapter.mock.calls[0][0];
    expect(config.headers.get('X-Telegram-Init-Data')).toBe(FRESH);
    expect(JSON.parse(config.data).init_data).toBe(FRESH);
  });

  it('preserves the existing app-cache fallback when neither live source is available', async () => {
    tokenStorage.setTelegramInitData(FRESH);
    const adapter = captureRequests();

    await apiClient.post('/cabinet/auth/telegram', { init_data: FRESH });

    expect(adapter.mock.calls[0][0].headers.get('X-Telegram-Init-Data')).toBe(FRESH);
  });

  it('does not add a Telegram header to email authentication', async () => {
    setBridge(FRESH);
    const adapter = captureRequests();

    await authApi.loginEmail('test@example.com', 'test-password');

    expect(adapter.mock.calls[0][0].headers.has('X-Telegram-Init-Data')).toBe(false);
  });

  it('checks the current Telegram user when clearing a previous account session', () => {
    setBridge(FRESH);
    retrieveRawInitData.mockReturnValue(OLD);
    localStorage.setItem('tg_user_id', '1');
    localStorage.setItem('refresh_token', 'old-refresh');
    localStorage.setItem('cabinet-auth', 'old-state');
    sessionStorage.setItem('access_token', 'old-access');

    clearStaleSessionIfNeeded(getTelegramInitData());

    expect(localStorage.getItem('tg_user_id')).toBe('2');
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('cabinet-auth')).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(tokenStorage.getTelegramInitData()).toBe(FRESH);
  });

  it('keeps the SDK raw-data reader confined to the shared helper', () => {
    const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
    const offenders: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && path !== join(srcDir, 'utils/telegramInitData.ts')) {
          if (readFileSync(path, 'utf8').includes('retrieveRawInitData')) offenders.push(path);
        }
      }
    }
    walk(srcDir);

    expect(offenders).toEqual([]);
    const main = readFileSync(join(srcDir, 'main.tsx'), 'utf8');
    expect(main).toContain('clearStaleSessionIfNeeded(getTelegramInitData())');
  });
});

describe('expired launch recovery', () => {
  const now = Date.UTC(2026, 9, 12);
  const seconds = now / 1000;

  it('recovers when BOTH sources have the same 90-day-old launch', () => {
    const stale = initData(seconds - 90 * 86400);
    setBridge(stale);
    retrieveRawInitData.mockReturnValue(stale);
    expect(needsTelegramAuthRecovery(getTelegramInitData(), now)).toBe(true);
  });

  it('keeps automatic login when one live source is fresh', () => {
    setBridge(initData(seconds - 90 * 86400));
    retrieveRawInitData.mockReturnValue(initData(seconds));
    expect(needsTelegramAuthRecovery(getTelegramInitData(), now)).toBe(false);
  });

  it.each([
    null,
    '',
    'hash=h',
    'auth_date=invalid&hash=h',
    'auth_date=1.5&hash=h',
    `auth_date=${seconds}`,
  ])('recovers from missing or malformed launch data: %s', (raw) => {
    expect(needsTelegramAuthRecovery(raw, now)).toBe(true);
  });

  it('matches the server age boundary and clock tolerance', () => {
    expect(needsTelegramAuthRecovery(initData(seconds - 30 * 86400), now)).toBe(false);
    expect(needsTelegramAuthRecovery(initData(seconds - 30 * 86400 - 1), now)).toBe(true);
    expect(needsTelegramAuthRecovery(initData(seconds + 300), now)).toBe(false);
    expect(needsTelegramAuthRecovery(initData(seconds + 301), now)).toBe(true);
  });
});
