import axios from 'axios';
import {
  getCloudStorageItem,
  setCloudStorageItem,
  deleteCloudStorageItem,
} from '@telegram-apps/sdk-react';
import { isInTelegramWebApp } from '../hooks/useTelegramSDK';
import { API } from '../config/constants';
import { reportPossibleBackendDown } from '../api/health';
import { isTemporaryAuthFailure } from './authFailure';

let sessionGeneration = 0;
let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;
export const getSessionGeneration = (): number => sessionGeneration;

export function assertSessionCurrent(generation: number): void {
  if (generation !== sessionGeneration) throw new axios.CanceledError('Session changed');
}

const TOKEN_KEYS = {
  ACCESS: 'access_token',
  REFRESH: 'refresh_token',
  USER: 'user',
  TELEGRAM_INIT: 'telegram_init_data',
} as const;

// --- Telegram CloudStorage backup for the refresh token ---
// The Telegram WebView can wipe localStorage between sessions. Mirroring the refresh
// token to per-user CloudStorage lets initialize() recover the session instead of
// dropping the user to the login screen. Best-effort: failures fall back to localStorage.
const CLOUD_REFRESH_KEY = TOKEN_KEYS.REFRESH;
const CLOUD_TIMEOUT_MS = 2500;

function mirrorRefreshTokenToCloud(refreshToken: string): void {
  if (!isInTelegramWebApp()) return;
  try {
    void setCloudStorageItem(CLOUD_REFRESH_KEY, refreshToken, { timeout: CLOUD_TIMEOUT_MS }).catch(
      () => {},
    );
  } catch {}
}

function removeRefreshTokenFromCloud(): void {
  if (!isInTelegramWebApp()) return;
  try {
    void deleteCloudStorageItem(CLOUD_REFRESH_KEY, { timeout: CLOUD_TIMEOUT_MS }).catch(() => {});
  } catch {}
}

export async function restoreRefreshTokenFromCloud(): Promise<string | null> {
  if (!isInTelegramWebApp()) return null;
  const generation = sessionGeneration;
  try {
    const value = await getCloudStorageItem(CLOUD_REFRESH_KEY, { timeout: CLOUD_TIMEOUT_MS });
    if (generation !== sessionGeneration) return tokenStorage.getRefreshToken();
    const token = value || null;
    if (token) {
      memoryRefreshToken = token;
      try {
        localStorage.setItem(TOKEN_KEYS.REFRESH, token);
      } catch {}
    }
    return token;
  } catch {
    return null;
  }
}

interface JWTPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string | null, bufferSeconds = 30): boolean {
  if (!token) return true;

  const payload = decodeJWT(token);
  if (!payload?.exp) return true;

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + bufferSeconds;
}

export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  return !isTokenExpired(token);
}

export const tokenStorage = {
  getAccessToken(): string | null {
    if (memoryAccessToken) return memoryAccessToken;
    try {
      return sessionStorage.getItem(TOKEN_KEYS.ACCESS) || memoryAccessToken;
    } catch {
      return memoryAccessToken;
    }
  },

  getRefreshToken(): string | null {
    if (memoryRefreshToken) return memoryRefreshToken;
    try {
      return (
        localStorage.getItem(TOKEN_KEYS.REFRESH) ||
        sessionStorage.getItem(TOKEN_KEYS.REFRESH) ||
        memoryRefreshToken
      );
    } catch {
      return memoryRefreshToken;
    }
  },

  setTokens(accessToken: string, refreshToken: string): void {
    sessionGeneration++;
    memoryAccessToken = accessToken;
    memoryRefreshToken = refreshToken;
    try {
      sessionStorage.setItem(TOKEN_KEYS.ACCESS, accessToken);
    } catch {}
    try {
      localStorage.setItem(TOKEN_KEYS.REFRESH, refreshToken);
    } catch {}
    try {
      sessionStorage.removeItem(TOKEN_KEYS.REFRESH);
    } catch {}
    mirrorRefreshTokenToCloud(refreshToken);
  },

  setAccessToken(accessToken: string): void {
    memoryAccessToken = accessToken;
    try {
      sessionStorage.setItem(TOKEN_KEYS.ACCESS, accessToken);
    } catch {
      console.error('Failed to save access token to sessionStorage');
    }
  },

  clearTokens(): void {
    sessionGeneration++;
    memoryAccessToken = null;
    memoryRefreshToken = null;
    for (const key of [TOKEN_KEYS.ACCESS, TOKEN_KEYS.REFRESH, TOKEN_KEYS.USER]) {
      try {
        sessionStorage.removeItem(key);
      } catch {}
      try {
        localStorage.removeItem(key);
      } catch {}
    }
    removeRefreshTokenFromCloud();
  },

  migrateFromLocalStorage(): void {
    try {
      const accessToken = localStorage.getItem(TOKEN_KEYS.ACCESS);
      if (accessToken && !sessionStorage.getItem(TOKEN_KEYS.ACCESS)) {
        sessionStorage.setItem(TOKEN_KEYS.ACCESS, accessToken);
      }
      localStorage.removeItem(TOKEN_KEYS.ACCESS);

      const refreshInSession = sessionStorage.getItem(TOKEN_KEYS.REFRESH);
      if (refreshInSession && !localStorage.getItem(TOKEN_KEYS.REFRESH)) {
        localStorage.setItem(TOKEN_KEYS.REFRESH, refreshInSession);
      }
      sessionStorage.removeItem(TOKEN_KEYS.REFRESH);
    } catch {}
  },

  getTelegramInitData(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEYS.TELEGRAM_INIT);
    } catch {
      return null;
    }
  },

  setTelegramInitData(data: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEYS.TELEGRAM_INIT, data);
    } catch {}
  },
};

function extractTelegramUserId(initData: string): string | null {
  try {
    const params = new URLSearchParams(initData);
    const userJson = params.get('user');
    if (!userJson) return null;
    const user = JSON.parse(userJson);
    return user.id != null ? String(user.id) : null;
  } catch {
    return null;
  }
}

const TG_USER_ID_KEY = 'tg_user_id';

export function clearStaleSessionIfNeeded(freshInitData: string | null): void {
  if (!freshInitData) return;

  try {
    const currentTgUserId = extractTelegramUserId(freshInitData);
    const storedTgUserId = localStorage.getItem(TG_USER_ID_KEY);

    if (storedTgUserId && currentTgUserId && storedTgUserId !== currentTgUserId) {
      sessionGeneration++;
      memoryAccessToken = null;
      memoryRefreshToken = null;
      sessionStorage.removeItem(TOKEN_KEYS.ACCESS);
      sessionStorage.removeItem(TOKEN_KEYS.REFRESH);
      sessionStorage.removeItem(TOKEN_KEYS.USER);
      localStorage.removeItem(TOKEN_KEYS.REFRESH);
      localStorage.removeItem('cabinet-auth');
    }

    if (currentTgUserId) {
      localStorage.setItem(TG_USER_ID_KEY, currentTgUserId);
    }

    sessionStorage.setItem(TOKEN_KEYS.TELEGRAM_INIT, freshInitData);
    localStorage.removeItem(TOKEN_KEYS.TELEGRAM_INIT);
  } catch {}
}

class TokenRefreshManager {
  private isRefreshing = false;
  private refreshGeneration = -1;
  private refreshPromise: Promise<string | null> | null = null;
  private subscribers: ((token: string | null) => void)[] = [];
  private refreshEndpoint = '/api/cabinet/auth/refresh';

  /**
   * True for temporary failures (network, 429, or 5xx), not rejected credentials.
   * Callers read this right after a null `refreshAccessToken()` to decide whether
   * to destroy the session (rejected token) or KEEP it so the recoverable
   * ServiceUnavailableScreen can resume once the backend returns. Synchronously
   * accurate: it is set inside doRefresh before the shared promise resolves, so
   * every awaiter (including deduped concurrent callers) reads a consistent value.
   */
  lastFailureWasTransport = false;

  setRefreshEndpoint(endpoint: string): void {
    this.refreshEndpoint = endpoint;
  }

  async refreshAccessToken(): Promise<string | null> {
    if (this.isRefreshing && this.refreshPromise && this.refreshGeneration === sessionGeneration) {
      return this.refreshPromise;
    }

    this.lastFailureWasTransport = false;

    const refreshToken = tokenStorage.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    this.isRefreshing = true;
    this.refreshGeneration = sessionGeneration;
    const promise = this.doRefresh(refreshToken, sessionGeneration);
    this.refreshPromise = promise;

    try {
      const result = await promise;
      this.notifySubscribers(result);
      return result;
    } finally {
      if (this.refreshPromise === promise) {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    }
  }

  // Uses plain axios (not apiClient) to avoid circular dependency
  private async doRefresh(refreshToken: string, generation: number): Promise<string | null> {
    try {
      const response = await axios.post<{ access_token?: string }>(
        this.refreshEndpoint,
        { refresh_token: refreshToken },
        // Without an explicit timeout this inherits axios's default of 0 (no
        // timeout): on the persisted-token bootstrap path an unreachable backend
        // would hang the refresh indefinitely, pinning the app on a blank loader.
        { headers: { 'Content-Type': 'application/json' }, timeout: API.TIMEOUT_MS },
      );

      assertSessionCurrent(generation);
      const newAccessToken = response.data.access_token;

      if (newAccessToken) {
        tokenStorage.setAccessToken(newAccessToken);
        return newAccessToken;
      }

      return null;
    } catch (err) {
      assertSessionCurrent(generation);
      if (axios.isCancel(err)) throw err;
      if (isTemporaryAuthFailure(err)) {
        this.lastFailureWasTransport = true;
        if (axios.isAxiosError(err) && err.response?.status !== 429) {
          void reportPossibleBackendDown();
        }
      }
      return null;
    }
  }

  subscribe(callback: (token: string | null) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
    };
  }

  private notifySubscribers(token: string | null): void {
    this.subscribers.forEach((cb) => cb(token));
    this.subscribers = [];
  }

  get isRefreshInProgress(): boolean {
    return this.isRefreshing;
  }

  async waitForRefresh(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    return tokenStorage.getAccessToken();
  }
}

export const tokenRefreshManager = new TokenRefreshManager();

const RETURN_URL_KEY = 'auth_return_url';

export function saveReturnUrl(): void {
  if (typeof window !== 'undefined') {
    const currentPath = window.location.pathname + window.location.search;
    if (currentPath && currentPath !== '/login') {
      try {
        sessionStorage.setItem(RETURN_URL_KEY, currentPath);
      } catch {}
    }
  }
}

export function getAndClearReturnUrl(): string | null {
  if (typeof window !== 'undefined') {
    try {
      const url = sessionStorage.getItem(RETURN_URL_KEY);
      sessionStorage.removeItem(RETURN_URL_KEY);
      return url;
    } catch {
      return null;
    }
  }
  return null;
}

export function safeRedirectToLogin(): void {
  if (typeof window !== 'undefined') {
    // Guard: don't redirect if already on /login to prevent infinite reload loops
    if (window.location.pathname === '/login') return;
    saveReturnUrl();
    window.location.href = '/login';
  }
}

export function isValidRedirectUrl(url: string): boolean {
  if (!url) return false;

  if (url.startsWith('/') && !url.startsWith('//')) {
    return true;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}
