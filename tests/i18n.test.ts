import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/hooks/useTelegramSDK', () => ({
  getTelegramLanguageCode: () => undefined,
}));

describe('lazy-loaded translations', () => {
  it('updates mounted forms when a language resource arrives', async () => {
    const { default: i18n } = await import('../src/i18n');
    expect(i18n.options.react?.bindI18nStore).toContain('added');
    await vi.waitFor(() => expect(i18n.hasResourceBundle('ru', 'translation')).toBe(true));
    expect(i18n.t('auth.loginViaBot', { lng: 'ru' })).toBe('Войти через бота');
    expect(i18n.t('auth.waitingForConfirmation', { lng: 'ru' })).not.toBe(
      'auth.waitingForConfirmation',
    );
  });
});
