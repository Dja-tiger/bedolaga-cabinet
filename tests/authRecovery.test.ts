import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  login: vi.fn(),
  admin: vi.fn(),
  cloud: vi.fn(),
  cloudSet: vi.fn(),
  cloudDelete: vi.fn(),
  report: vi.fn(),
  telegram: false,
}));
vi.mock('../src/api/auth', () => ({
  authApi: {
    getMe: mocks.getMe,
    loginTelegram: mocks.login,
    pollDeepLinkToken: mocks.login,
    logout: () => Promise.resolve(),
  },
}));
vi.mock('../src/api/client', () => ({ apiClient: { get: mocks.admin } }));
vi.mock('../src/api/health', () => ({ reportPossibleBackendDown: mocks.report }));
vi.mock('../src/hooks/useTelegramSDK', () => ({ isInTelegramWebApp: () => mocks.telegram }));
vi.mock('@telegram-apps/sdk-react', () => ({
  getCloudStorageItem: mocks.cloud,
  setCloudStorageItem: mocks.cloudSet,
  deleteCloudStorageItem: mocks.cloudDelete,
}));
vi.mock('../src/store/permissions', () => ({
  usePermissionStore: {
    getState: () => ({
      reset: vi.fn(),
      fetchPermissions: vi.fn(),
    }),
  },
}));

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function jwt(seconds = 3600) {
  return `e30.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.test`;
}
function failure(status?: number) {
  return new axios.AxiosError(
    'test failure',
    undefined,
    undefined,
    undefined,
    status
      ? {
          status,
          data: {},
          headers: {},
          statusText: '',
          config: { headers: new axios.AxiosHeaders() },
        }
      : undefined,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const user = { id: 123, first_name: 'QA' };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.telegram = false;
  mocks.getMe.mockResolvedValue(user);
  mocks.admin.mockResolvedValue({ data: { is_admin: false } });
  mocks.cloud.mockResolvedValue('');
  mocks.cloudSet.mockResolvedValue(undefined);
  mocks.cloudDelete.mockResolvedValue(undefined);
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('window', { location: { pathname: '/subscriptions', search: '', hash: '' } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('session recovery', () => {
  it.each([undefined, 429, 500, 502, 503, 504])(
    'preserves refresh credentials on temporary failure %s',
    async (status) => {
      const { tokenStorage, tokenRefreshManager } = await import('../src/utils/token');
      tokenStorage.setTokens(jwt(-60), 'valid-refresh');
      vi.spyOn(axios, 'post').mockRejectedValueOnce(failure(status));
      expect(await tokenRefreshManager.refreshAccessToken()).toBeNull();
      expect(tokenRefreshManager.lastFailureWasTransport).toBe(true);
      expect(tokenStorage.getRefreshToken()).toBe('valid-refresh');
    },
  );

  it('distinguishes rejected refresh credentials from an outage', async () => {
    const { tokenStorage, tokenRefreshManager } = await import('../src/utils/token');
    tokenStorage.setTokens(jwt(-60), 'expired-refresh');
    vi.spyOn(axios, 'post').mockRejectedValueOnce(failure(401));
    expect(await tokenRefreshManager.refreshAccessToken()).toBeNull();
    expect(tokenRefreshManager.lastFailureWasTransport).toBe(false);
  });

  it('stops the bootstrap loader and retries a temporarily unavailable profile', async () => {
    const { tokenStorage } = await import('../src/utils/token');
    tokenStorage.setTokens(jwt(-60), 'valid-refresh');
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: jwt() } });
    mocks.getMe.mockRejectedValueOnce(failure(503));
    const { useAuthStore, authInitializationNeedsRetry } = await import('../src/store/auth');
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(tokenStorage.getRefreshToken()).toBe('valid-refresh');
    expect(authInitializationNeedsRetry()).toBe(true);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(authInitializationNeedsRetry()).toBe(false);
  });

  it('does not attempt another refresh for a 500 profile response with a valid access token', async () => {
    const { tokenStorage } = await import('../src/utils/token');
    tokenStorage.setTokens(jwt(), 'valid-refresh');
    const post = vi.spyOn(axios, 'post');
    mocks.getMe.mockRejectedValueOnce(failure(500));
    const { useAuthStore } = await import('../src/store/auth');
    await useAuthStore.getState().initialize();
    expect(post).not.toHaveBeenCalled();
    expect(tokenStorage.getRefreshToken()).toBe('valid-refresh');
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('deduplicates refresh within one session', async () => {
    const { tokenStorage, tokenRefreshManager } = await import('../src/utils/token');
    tokenStorage.setTokens(jwt(-60), 'valid-refresh');
    const pending = deferred<{ data: { access_token: string } }>();
    const post = vi.spyOn(axios, 'post').mockReturnValue(pending.promise);
    const first = tokenRefreshManager.refreshAccessToken();
    const second = tokenRefreshManager.refreshAccessToken();
    pending.resolve({ data: { access_token: jwt() } });
    expect(await first).toBe(await second);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('cannot resurrect tokens after logout', async () => {
    const { tokenStorage, tokenRefreshManager } = await import('../src/utils/token');
    tokenStorage.setTokens(jwt(-60), 'old-refresh');
    const pending = deferred<{ data: { access_token: string } }>();
    vi.spyOn(axios, 'post').mockReturnValue(pending.promise);
    const result = tokenRefreshManager.refreshAccessToken().catch((error: unknown) => error);
    tokenStorage.clearTokens();
    pending.resolve({ data: { access_token: jwt() } });
    expect(axios.isCancel(await result)).toBe(true);
    expect(tokenStorage.getAccessToken()).toBeNull();
  });

  it('starts a separate refresh after switching accounts and ignores the old response', async () => {
    const { tokenStorage, tokenRefreshManager } = await import('../src/utils/token');
    const old = deferred<{ data: { access_token: string } }>();
    const next = deferred<{ data: { access_token: string } }>();
    vi.spyOn(axios, 'post').mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    tokenStorage.setTokens(jwt(-60), 'old-refresh');
    const first = tokenRefreshManager.refreshAccessToken().catch((error: unknown) => error);
    tokenStorage.setTokens(jwt(-60), 'new-refresh');
    const second = tokenRefreshManager.refreshAccessToken();
    old.resolve({ data: { access_token: 'old-access' } });
    expect(axios.isCancel(await first)).toBe(true);
    expect(tokenRefreshManager.isRefreshInProgress).toBe(true);
    next.resolve({ data: { access_token: 'new-access' } });
    expect(await second).toBe('new-access');
    expect(tokenStorage.getAccessToken()).toBe('new-access');
    expect(tokenStorage.getRefreshToken()).toBe('new-refresh');
  });

  it('ignores late login after the user logs out', async () => {
    const pending = deferred<unknown>();
    mocks.login.mockReturnValue(pending.promise);
    const { useAuthStore } = await import('../src/store/auth');
    const result = useAuthStore
      .getState()
      .loginWithTelegram('init')
      .catch((error: unknown) => error);
    useAuthStore.getState().logout();
    pending.resolve({ access_token: jwt(), refresh_token: 'old-refresh', user });
    expect(axios.isCancel(await result)).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('cannot apply a late bootstrap profile to a newly authenticated account', async () => {
    const { tokenStorage } = await import('../src/utils/token');
    tokenStorage.setTokens(jwt(), 'old-refresh');
    const pending = deferred<unknown>();
    mocks.getMe.mockReturnValue(pending.promise);
    const { useAuthStore } = await import('../src/store/auth');
    const boot = useAuthStore.getState().initialize();
    useAuthStore.getState().setTokens(jwt(), 'new-refresh');
    pending.resolve(user);
    await boot;
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('bounds Telegram CloudStorage requests and rejects stale cloud restoration', async () => {
    mocks.telegram = true;
    const { tokenStorage, restoreRefreshTokenFromCloud } = await import('../src/utils/token');
    const pending = deferred<string>();
    mocks.cloud.mockReturnValue(pending.promise);
    const restoring = restoreRefreshTokenFromCloud();
    expect(mocks.cloud).toHaveBeenCalledWith('refresh_token', { timeout: 2500 });
    tokenStorage.setTokens(jwt(), 'new-refresh');
    pending.resolve('old-cloud-refresh');
    expect(await restoring).toBe('new-refresh');
    expect(tokenStorage.getRefreshToken()).toBe('new-refresh');
  });

  it('does not crash login navigation when session storage is blocked', async () => {
    const { saveReturnUrl, getAndClearReturnUrl } = await import('../src/utils/token');
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    expect(() => saveReturnUrl()).not.toThrow();
    expect(getAndClearReturnUrl()).toBeNull();
  });

  it('can complete a login in memory when both storage APIs are blocked', async () => {
    const blocked = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('sessionStorage', blocked);
    vi.stubGlobal('localStorage', blocked);
    mocks.login.mockResolvedValue({ access_token: jwt(), refresh_token: 'new-refresh', user });
    const { useAuthStore } = await import('../src/store/auth');
    await useAuthStore.getState().loginWithTelegram('init');
    const { tokenStorage } = await import('../src/utils/token');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(tokenStorage.getRefreshToken()).toBe('new-refresh');
    useAuthStore.getState().logout();
    expect(tokenStorage.getAccessToken()).toBeNull();
  });

  it('does not loop or crash a chunk recovery with blocked storage', async () => {
    const { reloadAfterChunkFailure } = await import('../src/utils/chunkReload');
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    expect(reloadAfterChunkFailure()).toBe(true);
    expect(reloadAfterChunkFailure()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('blocked');
      },
    });
    expect(reloadAfterChunkFailure()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
