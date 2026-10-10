type GoalParams = Record<string, string | number | boolean>;
type YmFunction = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };
type YmWindow = Window & { ym?: YmFunction };

let counter: number | null = null;
let disabled = false;
let previousUrl: string | null = null;
// Keep the original route only in memory to distinguish masked page URLs.
let previousPathname: string | null = null;
const pending: { name: string; params?: GoalParams; key?: string; at: number }[] = [];
const completed = new Set<string>();
const storageKey = 'cabinet-metrika-completed-v1';

// Only canonical page names reach Metrika. Auth/payment tokens, ids and queries do not.
export function analyticsPath(pathname: string): string | null {
  if (pathname.startsWith('/admin')) return null;
  return pathname
    .replace(/\/buy\/success\/[^/]+/g, '/buy/success/_purchase')
    .replace(/\/buy\/gift\/[^/]+/g, '/buy/gift/_gift')
    .replace(/\/buy\/[^/]+/g, (path) =>
      ['/buy/success', '/buy/gift'].includes(path) ? path : '/buy/_landing',
    )
    .replace(/\/merge\/[^/]+/g, '/merge/_account')
    .replace(/\/(subscriptions|subscription|support(?:\/tickets)?)\/\d+/g, '/$1/_item');
}

function safeReferrer(referrer: string): string {
  try {
    const url = new URL(referrer);
    return url.origin + (analyticsPath(url.pathname) ?? '/');
  } catch {
    return '';
  }
}

function sendGoal(name: string, params?: GoalParams, key?: string): void {
  if (!counter || typeof window === 'undefined') return;
  const ym = (window as YmWindow).ym;
  if (!ym) return;
  let saved: Record<string, number> = {};
  if (key) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if (value && typeof value === 'object' && !Array.isArray(value))
        saved = value as Record<string, number>;
    } catch {
      /* Storage optional. */
    }
    if (completed.has(key) || saved[key]) return;
  }
  try {
    ym(counter, 'reachGoal', name, params ?? {});
    if (key) {
      completed.add(key);
      try {
        const cutoff = Date.now() - 90 * 86400000;
        saved = Object.fromEntries(Object.entries(saved).filter(([, at]) => at > cutoff));
        saved[key] = Date.now();
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } catch {
        /* Analytics never blocks the user flow. */
      }
    }
  } catch {
    /* Blockers or a failed counter must not break API calls. */
  }
}

export function trackGoal(name: string, params?: GoalParams, key?: string): void {
  if (typeof window === 'undefined' || disabled) return;
  if (!counter || !previousUrl) {
    if (pending.length < 100) pending.push({ name, params, key, at: Date.now() });
    return;
  }
  sendGoal(name, params, key);
}

export async function trackGoalOnce(
  name: string,
  identity: string,
  params?: GoalParams,
): Promise<void> {
  // Hash locally; neither the raw purchase token nor its hash is sent to Yandex.
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const key =
      name +
      ':' +
      Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
    trackGoal(name, params, key);
  } catch {
    /* Unsupported crypto: skip repeated-payment tracking rather than inflate it. */
  }
}

export function configureMetrika(id: string): void {
  if (typeof window === 'undefined') return;
  if (!/^\d{1,15}$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
    if (counter)
      try {
        (window as YmWindow).ym?.(counter, 'destruct');
      } catch {
        /* optional */
      }
    try {
      localStorage.removeItem('ym_counter_id');
    } catch {
      /* Storage optional. */
    }
    counter = null;
    disabled = true;
    previousUrl = null;
    previousPathname = null;
    pending.length = 0;
    return;
  }
  try {
    localStorage.setItem('ym_counter_id', id);
  } catch {
    /* Storage optional. */
  }
  const next = Number(id);
  if (counter === next) return;
  const w = window as YmWindow;
  if (counter)
    try {
      w.ym?.(counter, 'destruct');
    } catch {
      /* optional */
    }
  if (!w.ym) {
    const queued: YmFunction = (...args) => {
      queued.a?.push(args);
    };
    queued.a = [];
    queued.l = Date.now();
    w.ym = queued;
  }
  if (!document.querySelector('script[src^="https://mc.yandex.ru/metrika/tag.js"]')) {
    const script = document.createElement('script');
    script.id = 'ym-counter-script';
    script.async = true;
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(script);
  }
  counter = next;
  disabled = false;
  previousUrl = null;
  previousPathname = null;
  // Manual hit sends sanitized URLs, including the first view.
  w.ym(counter, 'init', {
    defer: true,
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
    url: location.origin + (analyticsPath(location.pathname) ?? '/'),
    referrer: safeReferrer(document.referrer),
  });
}

const pageGoals: [RegExp, string][] = [
  [/^\/login$/, 'login_view'],
  [/^\/subscription\/purchase$/, 'subscription_purchase_view'],
  [/^\/subscriptions\/_item\/renew$/, 'subscription_renew_view'],
  [/^\/balance\/top-up$/, 'topup_view'],
  [/^\/connection(?:\/|$)/, 'connection_view'],
  [/^\/buy\/_landing$/, 'quick_purchase_view'],
];

export function trackPage(pathname: string): void {
  if (!counter || typeof window === 'undefined') return;
  const path = analyticsPath(pathname);
  if (!path) {
    previousPathname = pathname;
    return;
  }
  const query = new URLSearchParams();
  const input = new URLSearchParams(location.search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = input.get(key);
    if (value && /^[\p{L}\p{N}_ .-]{1,100}$/u.test(value)) query.set(key, value);
  }
  const url = location.origin + path + (query.size ? '?' + query.toString() : '');
  if (pathname === previousPathname && url === previousUrl) return;
  try {
    (window as YmWindow).ym?.(counter, 'hit', url, {
      title: 'Cabinet ' + path,
      referer: previousUrl ?? safeReferrer(document.referrer),
      params: { cabinet_page: path },
    });
    previousUrl = url;
    previousPathname = pathname;
    for (const [pattern, goal] of pageGoals) if (pattern.test(path)) sendGoal(goal);
    // Send early auth/business events only after the first page view.
    for (const item of pending.splice(0))
      if (Date.now() - item.at < 60000) sendGoal(item.name, item.params, item.key);
  } catch {
    /* Optional analytics. */
  }
}
