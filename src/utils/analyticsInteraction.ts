import { trackGoal } from './analytics';

const platforms = new Set(['ios', 'android', 'windows', 'macos', 'linux', 'androidTV', 'appleTV']);
const apps = [
  'incy',
  'happ',
  'hiddify',
  'v2raytun',
  'streisand',
  'shadowrocket',
  'v2rayng',
  'nekobox',
  'sing-box',
  'clash',
  'v2rayn',
];

/** Only categorical names reach analytics, never import links, app config or subscription tokens. */
export function connectionAnalyticsParams(platform?: string, app?: string) {
  const name = app?.trim().toLowerCase() ?? '';
  return {
    connection_platform: platforms.has(platform ?? '') ? platform! : 'other',
    connection_app:
      apps.find((candidate) => name === candidate || name.startsWith(candidate + ' ')) ?? 'other',
  };
}

export type ConnectionAction =
  | 'platform_selected'
  | 'app_selected'
  | 'import_clicked'
  | 'link_copied'
  | 'download_clicked';

export function trackConnectionAction(action: ConnectionAction, platform?: string, app?: string) {
  trackGoal('connection_' + action, connectionAnalyticsParams(platform, app));
}

export function trackPaymentLinkAction(action: 'ready' | 'opened' | 'copied') {
  trackGoal('payment_link_' + action);
}
