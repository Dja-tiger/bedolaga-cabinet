import type { AppConfig, LocalizedText, RemnawaveAppClient } from '../types';

export const INCY_APP_STORE_URL = 'https://apps.apple.com/ru/app/incy/id6756943388?l=ru';

const text = (ru: string, en: string, zh: string, fa: string): LocalizedText => ({
  ru,
  en,
  zh,
  fa,
});

function createIncyApp(subscriptionUrl: string | null): RemnawaveAppClient {
  // INCY's documented import scheme accepts the original subscription URL.
  // A Happ cryptolink cannot be imported by another client.
  const deepLink =
    subscriptionUrl && /^https?:\/\//i.test(subscriptionUrl)
      ? `incy://import/${subscriptionUrl}`
      : null;
  return {
    name: 'INCY',
    featured: true,
    deepLink,
    blocks: [
      {
        title: text('Установите INCY', 'Install INCY', '安装 INCY', 'نصب INCY'),
        description: text(
          'Скачайте приложение из App Store для iPhone, iPad или Mac.',
          'Download the app from the App Store for iPhone, iPad or Mac.',
          '从 App Store 下载适用于 iPhone、iPad 或 Mac 的应用。',
          'برنامه را برای iPhone، iPad یا Mac از App Store دانلود کنید.',
        ),
        buttons: [{ type: 'external', url: INCY_APP_STORE_URL, text: { en: 'App Store' } }],
      },
      {
        title: text('Добавьте подписку', 'Add your subscription', '添加订阅', 'افزودن اشتراک'),
        description: deepLink
          ? text(
              'После установки нажмите кнопку ниже и подтвердите импорт подписки в INCY.',
              'After installation, tap the button below and confirm importing your subscription into INCY.',
              '安装后，点击下方按钮并确认将订阅导入 INCY。',
              'پس از نصب، دکمه زیر را بزنید و وارد کردن اشتراک به INCY را تأیید کنید.',
            )
          : text(
              'Ссылка для импорта недоступна. Обратитесь в поддержку.',
              'The import link is unavailable. Please contact support.',
              '导入链接不可用，请联系支持。',
              'لینک وارد کردن اشتراک در دسترس نیست. با پشتیبانی تماس بگیرید.',
            ),
        buttons: deepLink
          ? [
              {
                type: 'subscriptionLink',
                url: deepLink,
                text: text('Добавить в INCY', 'Add to INCY', '添加到 INCY', 'افزودن به INCY'),
              },
            ]
          : [],
      },
      {
        title: text('Подключитесь к VPN', 'Connect to VPN', '连接 VPN', 'اتصال به VPN'),
        description: text(
          'В INCY выберите сервер и включите подключение. Разрешите добавление VPN-конфигурации, если устройство запросит.',
          'Select a server in INCY and turn on the connection. Allow adding a VPN configuration if your device asks.',
          '在 INCY 中选择服务器并开启连接。如果设备提示，请允许添加 VPN 配置。',
          'در INCY یک سرور انتخاب کرده و اتصال را روشن کنید. اگر دستگاه درخواست کرد، اجازه افزودن پیکربندی VPN را بدهید.',
        ),
      },
    ],
  };
}

function isIncyApp(app: RemnawaveAppClient): boolean {
  return (
    app.name.trim().toLowerCase() === 'incy' ||
    /^incy:\/\//i.test(app.deepLink ?? '') ||
    app.blocks.some((block) =>
      block.buttons?.some((button) => (button.url ?? button.link ?? '').includes('/id6756943388')),
    )
  );
}

/** Keep the panel's other apps and instructions; prefer INCY on Apple phones and Macs. */
export function withIncyApps(config: AppConfig): AppConfig {
  const platforms = { ...config.platforms };
  for (const key of ['ios', 'macos']) {
    const platform = platforms[key];
    const apps = platform?.apps ?? [];
    const index = apps.findIndex(isIncyApp);
    const incy =
      index >= 0 ? { ...apps[index], featured: true } : createIncyApp(config.subscriptionUrl);
    platforms[key] = {
      ...platform,
      apps: [incy, ...apps.filter((_, i) => i !== index)],
    };
  }
  return { ...config, platforms };
}
