import { analyticsPath, analyticsUrl, safeReferrer, pageGoals } from './analyticsPage';

type GoalParams = Record<string, string | number | boolean>;
type GoogleWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
} & { [key: `ga-disable-${string}`]: boolean | undefined };

export const isGoogleAnalyticsId = (id: string): boolean => /^G-[A-Z0-9]{4,30}$/.test(id);

let measurementId = '';
let adsId = '';
let disabled = false;
let previousUrl = '';
let previousPathname = '';
let generation = 0;
const pending: { name: string; params?: GoalParams; key?: string; at: number }[] = [];
const completed = new Set<string>();
const storagePrefix = 'cabinet-ga4-completed-v1:';

export function configureGoogleAnalytics(id: string, conversionId = ''): void {
  if (typeof window === 'undefined') return;
  const next = isGoogleAnalyticsId(id) ? id : '';
  const nextAds = /^AW-\d{1,25}$/.test(conversionId) ? conversionId : '';
  const w = window as unknown as GoogleWindow;
  try {
    if (measurementId !== next || (!next && !disabled)) {
      if (measurementId) w[`ga-disable-${measurementId}`] = true;
      if (measurementId || !next) pending.length = 0;
      measurementId = next;
      disabled = !next;
      previousUrl = '';
      previousPathname = '';
      completed.clear();
      generation++;
      if (next) w[`ga-disable-${next}`] = false;
    } else if (adsId === nextAds) return;

    if (!next && !nextAds) {
      adsId = '';
      return;
    }
    if (!w.gtag) {
      w.dataLayer ??= [];
      w.gtag = function () {
        // gtag.js consumes the arguments object, as in Google's installation snippet.
        // eslint-disable-next-line prefer-rest-params -- Keep the official gtag queue contract.
        w.dataLayer?.push(arguments);
      };
      w.gtag('js', new Date());
    }
    if (next && !previousUrl) {
      // Never allow the config command to send the original URL or document title.
      w.gtag('config', next, {
        send_page_view: false,
        page_location: analyticsUrl(analyticsPath(location.pathname) ?? '/'),
        page_referrer: safeReferrer(document.referrer),
        page_title: 'Cabinet',
      });
    }
    if (nextAds && nextAds !== adsId) w.gtag('config', nextAds);
    adsId = nextAds;
    if (!document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]')) {
      const loader = document.createElement('script');
      loader.id = 'gtag-loader-script';
      loader.async = true;
      loader.src = `https://www.googletagmanager.com/gtag/js?id=${next || nextAds}`;
      document.head.appendChild(loader);
    }
  } catch {
    /* Optional analytics cannot interrupt rendering or payments. */
  }
}

function sendGoal(name: string, params?: GoalParams, key?: string): void {
  if (!measurementId || !previousUrl) return;
  const w = window as unknown as GoogleWindow;
  if (!w.gtag) return;
  let saved: Record<string, number> = {};
  const storageKey = storagePrefix + measurementId;
  const cutoff = Date.now() - 90 * 86400000;
  if (key) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        saved = Object.fromEntries(
          Object.entries(value).filter(([, at]) => typeof at === 'number' && at > cutoff),
        );
      }
    } catch {
      /* Storage optional. */
    }
    if (completed.has(key) || saved[key]) return;
  }
  try {
    w.gtag('event', name, {
      ...params,
      send_to: measurementId,
      page_location: previousUrl,
      page_referrer: safeReferrer(document.referrer),
      page_title: 'Cabinet ' + (analyticsPath(previousPathname) ?? '/'),
    });
    if (key) {
      completed.add(key);
      try {
        saved[key] = Date.now();
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } catch {
        /* Analytics never blocks the user flow. */
      }
    }
  } catch {
    /* A blocked or failed Google tag must not break API calls. */
  }
}

export function trackGoogleGoal(name: string, params?: GoalParams, key?: string): void {
  if (typeof window === 'undefined' || disabled) return;
  if (!measurementId || !previousUrl) {
    if (pending.length < 100) pending.push({ name, params, key, at: Date.now() });
    return;
  }
  // Business events from an admin route are also excluded.
  if (!analyticsPath(previousPathname)) return;
  sendGoal(name, params, key);
}

export async function trackGoogleGoalOnce(
  name: string,
  identity: string,
  params?: GoalParams,
): Promise<void> {
  const started = generation;
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    if (started !== generation) return;
    const key =
      name +
      ':' +
      Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
    trackGoogleGoal(name, params, key);
  } catch {
    /* Skip payment polling events when local hashing is unavailable. */
  }
}

export function trackGooglePage(pathname: string): void {
  if (!measurementId || typeof window === 'undefined') return;
  const path = analyticsPath(pathname);
  if (!path) {
    previousPathname = pathname;
    return;
  }
  const url = analyticsUrl(path);
  if (pathname === previousPathname && url === previousUrl) return;
  const w = window as unknown as GoogleWindow;
  if (!w.gtag) return;
  try {
    const page = {
      page_location: url,
      page_title: 'Cabinet ' + path,
      page_referrer: previousUrl || safeReferrer(document.referrer),
    };
    // Keep automatic engagement events' page context sanitized as well.
    w.gtag('set', page);
    w.gtag('event', 'page_view', { ...page, send_to: measurementId });
    previousUrl = url;
    previousPathname = pathname;
    for (const [pattern, goal] of pageGoals) if (pattern.test(path)) sendGoal(goal);
    for (const item of pending.splice(0))
      if (Date.now() - item.at < 60000) sendGoal(item.name, item.params, item.key);
  } catch {
    /* Optional analytics. */
  }
}
