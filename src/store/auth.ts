import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import axios from 'axios';
import type { CampaignBonusInfo, RegisterResponse, User } from '../types';
import { authApi } from '../api/auth';
import { apiClient } from '../api/client';
import {
  captureCampaignFromUrl,
  consumeCampaignSlug,
  getPendingCampaignSlug,
} from '../utils/campaign';
import {
  captureReferralFromUrl,
  consumeReferralCode,
  getPendingReferralCode,
} from '../utils/referral';
import {
  tokenStorage,
  isTokenValid,
  tokenRefreshManager,
  restoreRefreshTokenFromCloud,
  getSessionGeneration,
  assertSessionCurrent,
} from '../utils/token';
import { isTemporaryAuthFailure } from '../utils/authFailure';
import { usePermissionStore } from './permissions';
import { useBlockingStore } from './blocking';

export interface TelegramWidgetData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  pendingCampaignBonus: CampaignBonusInfo | null;

  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  clearCampaignBonus: () => void;
  logout: () => void;
  initialize: () => Promise<void>;
  refreshUser: () => Promise<void>;
  checkAdminStatus: () => Promise<void>;
  loginWithTelegram: (initData: string) => Promise<void>;
  loginWithTelegramWidget: (data: TelegramWidgetData) => Promise<void>;
  loginWithTelegramOIDC: (idToken: string) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (
    provider: string,
    code: string,
    state: string,
    deviceId?: string | null,
  ) => Promise<void>;
  loginWithDeepLink: (
    token: string,
    campaignSlug?: string | null,
    signal?: AbortSignal,
  ) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    firstName?: string,
    referralCode?: string,
  ) => Promise<RegisterResponse>;
}

const initState = {
  promise: null as Promise<void> | null,
  isInitializing: false,
  isInitialized: false,
};

export const authInitializationNeedsRetry = (): boolean => !initState.isInitialized;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      isLoading: true,
      isAdmin: false,
      pendingCampaignBonus: null,

      clearCampaignBonus: () => set({ pendingCampaignBonus: null }),

      setTokens: (accessToken, refreshToken) => {
        if (!accessToken || !refreshToken) {
          throw new Error('Invalid tokens: cannot store empty credentials');
        }
        tokenStorage.setTokens(accessToken, refreshToken);
        set({
          accessToken,
          refreshToken,
          isAuthenticated: true,
        });
      },

      setUser: (user) => {
        set({ user });
      },

      setIsAdmin: (isAdmin) => {
        set({ isAdmin });
      },

      logout: () => {
        const refreshToken = tokenStorage.getRefreshToken();
        if (refreshToken) {
          authApi.logout(refreshToken).catch(() => {});
        }
        tokenStorage.clearTokens();
        usePermissionStore.getState().reset();
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
          isAdmin: false,
        });
      },

      checkAdminStatus: async () => {
        const generation = getSessionGeneration();
        try {
          const token = tokenStorage.getAccessToken();
          if (!token || !isTokenValid(token)) {
            set({ isAdmin: false });
            usePermissionStore.getState().reset();
            return;
          }
          const response = await apiClient.get<{ is_admin: boolean }>('/cabinet/auth/me/is-admin');
          assertSessionCurrent(generation);
          set({ isAdmin: response.data.is_admin });
          if (response.data.is_admin) {
            await usePermissionStore.getState().fetchPermissions();
          } else {
            usePermissionStore.getState().reset();
          }
        } catch {
          if (generation !== getSessionGeneration()) return;
          set({ isAdmin: false });
          usePermissionStore.getState().reset();
        }
      },

      refreshUser: async () => {
        const generation = getSessionGeneration();
        try {
          const user = await authApi.getMe();
          assertSessionCurrent(generation);
          set({ user });
        } catch {}
      },

      initialize: async () => {
        if (initState.isInitialized) {
          return;
        }

        if (initState.isInitializing && initState.promise) {
          return initState.promise;
        }

        const generation = getSessionGeneration();
        let retryInitialization = false;
        const applySession = (
          accessToken: string | null,
          refreshTokenValue: string,
          user: User,
        ): void => {
          assertSessionCurrent(generation);
          set({
            accessToken,
            refreshToken: refreshTokenValue,
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        };
        const clearSession = (): void => {
          assertSessionCurrent(generation);
          tokenStorage.clearTokens();
          set({
            accessToken: null,
            refreshToken: null,
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
        };

        initState.isInitializing = true;
        initState.promise = (async () => {
          try {
            set({ isLoading: true });

            tokenStorage.migrateFromLocalStorage();

            let accessToken = tokenStorage.getAccessToken();
            let refreshToken = tokenStorage.getRefreshToken();

            if (!refreshToken) {
              // localStorage may have been wiped by the Telegram WebView; try to
              // recover the refresh token from Telegram CloudStorage before giving up.
              refreshToken = await restoreRefreshTokenFromCloud();
              assertSessionCurrent(generation);
              if (!refreshToken) {
                set({ isLoading: false, isAuthenticated: false });
                return;
              }
            }

            if (!isTokenValid(accessToken)) {
              const newToken = await tokenRefreshManager.refreshAccessToken();
              assertSessionCurrent(generation);
              if (newToken) {
                accessToken = newToken;
              } else if (tokenRefreshManager.lastFailureWasTransport) {
                retryInitialization = true;
                if (!useBlockingStore.getState().blockingType) {
                  useBlockingStore.getState().setBackendUnavailable();
                }
                return;
              } else {
                clearSession();
                return;
              }
            }

            try {
              const user = await authApi.getMe();
              await get().checkAdminStatus();
              applySession(accessToken, refreshToken, user);
            } catch (error) {
              assertSessionCurrent(generation);
              if (isTemporaryAuthFailure(error) || axios.isCancel(error)) throw error;
              if (!axios.isAxiosError(error) || error.response?.status !== 401) throw error;
              const newToken = await tokenRefreshManager.refreshAccessToken();
              assertSessionCurrent(generation);
              if (newToken) {
                const user = await authApi.getMe();
                await get().checkAdminStatus();
                applySession(newToken, refreshToken, user);
              } else if (tokenRefreshManager.lastFailureWasTransport) {
                retryInitialization = true;
                if (!useBlockingStore.getState().blockingType) {
                  useBlockingStore.getState().setBackendUnavailable();
                }
              } else {
                clearSession();
              }
            }
          } catch (error) {
            if (axios.isCancel(error) || generation !== getSessionGeneration()) return;
            if (isTemporaryAuthFailure(error)) {
              // An unavailable profile/refresh endpoint is not an invalid session.
              retryInitialization = true;
              if (!useBlockingStore.getState().blockingType) {
                useBlockingStore.getState().setBackendUnavailable();
              }
            } else {
              clearSession();
            }
          } finally {
            set({ isLoading: false });
            initState.isInitializing = false;
            initState.isInitialized = !retryInitialization;
            initState.promise = null;
          }
        })();

        return initState.promise;
      },

      loginWithTelegram: async (initData) => {
        const generation = getSessionGeneration();
        const campaignSlug = getPendingCampaignSlug();
        const referralCode = getPendingReferralCode();
        const response = await authApi.loginTelegram(initData, campaignSlug, referralCode);
        assertSessionCurrent(generation);
        // Clear only after successful auth — retry keeps the slugs
        consumeCampaignSlug();
        consumeReferralCode();
        tokenStorage.setTokens(response.access_token, response.refresh_token);
        set({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          user: response.user,
          isAuthenticated: true,
          pendingCampaignBonus: response.campaign_bonus || null,
        });
        await get().checkAdminStatus();
      },

      loginWithTelegramWidget: async (data) => {
        const generation = getSessionGeneration();
        const campaignSlug = getPendingCampaignSlug();
        const referralCode = getPendingReferralCode();
        const response = await authApi.loginTelegramWidget(data, campaignSlug, referralCode);
        assertSessionCurrent(generation);
        consumeCampaignSlug();
        consumeReferralCode();
        tokenStorage.setTokens(response.access_token, response.refresh_token);
        set({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          user: response.user,
          isAuthenticated: true,
          pendingCampaignBonus: response.campaign_bonus || null,
        });
        await get().checkAdminStatus();
      },

      loginWithTelegramOIDC: async (idToken) => {
        const generation = getSessionGeneration();
        const campaignSlug = getPendingCampaignSlug();
        const referralCode = getPendingReferralCode();
        const response = await authApi.loginTelegramOIDC(idToken, campaignSlug, referralCode);
        assertSessionCurrent(generation);
        consumeCampaignSlug();
        consumeReferralCode();
        tokenStorage.setTokens(response.access_token, response.refresh_token);
        set({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          user: response.user,
          isAuthenticated: true,
          pendingCampaignBonus: response.campaign_bonus || null,
        });
        await get().checkAdminStatus();
      },

      loginWithEmail: async (email, password) => {
        const generation = getSessionGeneration();
        const campaignSlug = getPendingCampaignSlug();
        const referralCode = getPendingReferralCode();
        const response = await authApi.loginEmail(email, password, campaignSlug, referralCode);
        assertSessionCurrent(generation);
        consumeCampaignSlug();
        consumeReferralCode();
        tokenStorage.setTokens(response.access_token, response.refresh_token);
        set({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          user: response.user,
          isAuthenticated: true,
          pendingCampaignBonus: response.campaign_bonus || null,
        });
        await get().checkAdminStatus();
      },

      loginWithOAuth: async (provider, code, state, deviceId) => {
        const generation = getSessionGeneration();
        const campaignSlug = getPendingCampaignSlug();
        const referralCode = getPendingReferralCode();
        const response = await authApi.oauthCallback(
          provider,
          code,
          state,
          deviceId,
          campaignSlug,
          referralCode,
        );
        assertSessionCurrent(generation);
        consumeCampaignSlug();
        consumeReferralCode();
        tokenStorage.setTokens(response.access_token, response.refresh_token);
        set({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          user: response.user,
          isAuthenticated: true,
          pendingCampaignBonus: response.campaign_bonus || null,
        });
        await get().checkAdminStatus();
      },

      loginWithDeepLink: async (token, campaignSlug, signal) => {
        const generation = getSessionGeneration();
        const response = await authApi.pollDeepLinkToken(token, campaignSlug, signal);
        assertSessionCurrent(generation);
        if (signal?.aborted) throw new axios.CanceledError('Authentication cancelled');
        if (!response.access_token || !response.refresh_token) {
          throw new Error('Invalid auth response: missing tokens');
        }
        tokenStorage.setTokens(response.access_token, response.refresh_token);
        set({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          user: response.user,
          isAuthenticated: true,
          pendingCampaignBonus: response.campaign_bonus || null,
        });
        await get().checkAdminStatus();
      },

      registerWithEmail: async (email, password, firstName, referralCode) => {
        const code = referralCode || getPendingReferralCode() || undefined;
        const campaignSlug = getPendingCampaignSlug() || undefined;
        const response = await authApi.registerEmailStandalone({
          email,
          password,
          first_name: firstName,
          language: navigator.language.split('-')[0] || 'ru',
          referral_code: code,
          campaign_slug: campaignSlug,
        });
        consumeReferralCode();
        return response;
      },
    }),
    {
      name: 'cabinet-auth',
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          try {
            return localStorage.getItem(name);
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, value);
          } catch {}
        },
        removeItem: (name) => {
          try {
            localStorage.removeItem(name);
          } catch {}
        },
      })),
      partialize: (state) => ({
        user: state.user,
      }),
    },
  ),
);

captureCampaignFromUrl();
captureReferralFromUrl();

// Note: initialize() is kicked off from main.tsx after the Telegram SDK is set up,
// so CloudStorage-backed token recovery can run during bootstrap.
