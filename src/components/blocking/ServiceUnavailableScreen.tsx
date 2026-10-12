import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useBlockingStore } from '../../store/blocking';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { pingBackend } from '../../api/health';
import { useAuthStore, authInitializationNeedsRetry } from '../../store/auth';
import { HEALTH } from '../../config/constants';
import { CloudWarningIcon, RestartIcon } from '@/components/icons';
import { Button } from '@/components/primitives';
import { cn } from '@/lib/utils';
import BlockingShell from './BlockingShell';

/**
 * Full-screen state shown when the backend is unreachable (transport-level
 * failure), replacing the blank loader the app used to get stuck on. Polls the
 * liveness endpoint and retries an unfinished auth bootstrap without discarding
 * credentials. A manual retry button
 * lets the user force an immediate check.
 */
export default function ServiceUnavailableScreen() {
  const { t } = useTranslation();
  const clearBlocking = useBlockingStore((state) => state.clearBlocking);
  const queryClient = useQueryClient();
  const [isChecking, setIsChecking] = useState(false);
  const isCheckingRef = useRef(false);

  const recover = useCallback(async () => {
    await useAuthStore.getState().initialize();
    if (authInitializationNeedsRetry()) return false;
    clearBlocking();
    void queryClient.invalidateQueries();
    return true;
  }, [clearBlocking, queryClient]);

  // Manual retry: immediate probe with a visible checking state.
  const handleRetry = useCallback(async () => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    setIsChecking(true);
    try {
      if (await pingBackend()) {
        await recover();
      }
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, [recover]);

  // Auto-recovery: probe on mount, then re-schedule after each result resolves. Self-chaining
  // (rather than a fixed setInterval) prevents the now-longer tolerant probe from overlapping
  // with itself.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (cancelled) return;
      if (await pingBackend()) {
        if (!cancelled && (await recover())) return;
      }
      if (!cancelled) timer = setTimeout(tick, HEALTH.RECOVERY_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [recover]);

  const screenRef = useFocusTrap<HTMLDivElement>(true, { lockScroll: false });

  return (
    <BlockingShell
      screenRef={screenRef}
      titleId="service-unavailable-title"
      accent="warning"
      ariaLive="polite"
      icon={<CloudWarningIcon className="h-9 w-9" />}
      title={t('blocking.serviceUnavailable.title')}
      description={t('blocking.serviceUnavailable.description')}
      pulse
      footer={t('blocking.serviceUnavailable.hint')}
      actions={
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={handleRetry}
          disabled={isChecking}
          leftIcon={<RestartIcon className={cn('h-5 w-5', isChecking && 'animate-spin')} />}
        >
          {isChecking
            ? t('blocking.serviceUnavailable.checking')
            : t('blocking.serviceUnavailable.retry')}
        </Button>
      }
    />
  );
}
