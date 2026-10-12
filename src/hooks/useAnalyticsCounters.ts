import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brandingApi } from '../api/branding';
import { setYandexCid } from '../utils/yandexCid';
import { useLocation } from 'react-router';
import { configureMetrika, trackPage } from '../utils/metrika';
import { configureGoogleAnalytics, trackGooglePage } from '../utils/googleAnalytics';
import { trackGoal } from '../utils/analytics';

/**
 * Fetches analytics counter settings from the API and dynamically
 * initializes Yandex Metrika, Google Analytics 4 and Google Ads into <head>.
 */
export function useAnalyticsCounters() {
  const { pathname } = useLocation();
  const { data } = useQuery({
    queryKey: ['analytics-counters'],
    queryFn: brandingApi.getAnalyticsCounters,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  useEffect(() => {
    if (!data) return;

    configureMetrika(data.yandex_metrika_id);
    if (/^\d{1,15}$/.test(data.yandex_metrika_id)) {
      cacheYandexCid(data.yandex_metrika_id);
      syncYandexCid(data.yandex_metrika_id);
    }

    configureGoogleAnalytics(data.google_analytics_id ?? '', data.google_ads_id);
  }, [data]);

  useEffect(() => {
    if (data?.yandex_metrika_id) trackPage(pathname);
    if (data?.google_analytics_id) trackGooglePage(pathname);
  }, [pathname, data?.yandex_metrika_id, data?.google_analytics_id]);
}

function cacheYandexCid(counterId: string) {
  const w = window as unknown as Record<string, unknown>;
  const ym = w.ym as ((...args: unknown[]) => void) | undefined;
  if (typeof ym !== 'function') return;
  setTimeout(() => {
    try {
      (w.ym as (...args: unknown[]) => void)(Number(counterId), 'getClientID', (cid: string) => {
        if (cid) setYandexCid(cid);
      });
    } catch {
      /* ignore */
    }
  }, 2000);
}

function syncYandexCid(counterId: string) {
  const SENT_KEY = 'ym_cid_sent';
  try {
    if (localStorage.getItem(SENT_KEY)) return;
  } catch {
    return;
  }
  const w = window as unknown as Record<string, unknown>;
  const ym = w.ym as ((...args: unknown[]) => void) | undefined;
  if (typeof ym !== 'function') return;
  setTimeout(() => {
    try {
      (w.ym as (...args: unknown[]) => void)(Number(counterId), 'getClientID', (cid: string) => {
        if (!cid) return;
        setYandexCid(cid);
        // Only POST when the user is authenticated. Guest sessions cache the
        // CID locally; it gets synced after login by the next mount of this
        // hook on the cabinet shell.
        let token: string | null = null;
        try {
          token = localStorage.getItem('access_token');
        } catch {
          /* ignore */
        }
        if (!token) return;
        // Route through brandingApi (apiClient) so baseURL, auth refresh, and
        // error handling all flow through the same interceptors as every other
        // cabinet API call. brandingApi уже импортирован статически — динамический
        // import('../api/branding') ломал code-splitting (Vite warning о том, что
        // модуль не может быть вынесен в отдельный chunk при mixed static+dynamic).
        brandingApi
          .storeYandexCid(cid)
          .then(() => {
            try {
              localStorage.setItem(SENT_KEY, '1');
            } catch {
              /* ignore */
            }
          })
          .catch(() => {
            /* swallow -- non-critical, will retry on next login */
          });
      });
    } catch {
      /* ignore */
    }
  }, 3000);
}

export function fireAnalyticsEvent(
  goalName: string,
  params?: Record<string, string | number | boolean>,
) {
  trackGoal(goalName, params);
}

// Re-export the canonical CID accessor from utils for back-compat with
// existing imports inside this hook file. New code should import from
// '../utils/yandexCid' directly to avoid pulling React into api/.
export { getYandexCid } from '../utils/yandexCid';
