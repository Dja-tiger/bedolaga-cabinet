import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { CheckIcon, CloseIcon, CopyIcon, ExternalLinkIcon } from '@/components/icons';

interface PaymentLinkDialogProps {
  paymentUrl: string;
  open: boolean;
  copied: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPayment: () => void;
  onCopy: () => void;
  onCloseFocus: () => void;
}

export function PaymentLinkDialog({
  paymentUrl,
  open,
  copied,
  onOpenChange,
  onOpenPayment,
  onCopy,
  onCloseFocus,
}: PaymentLinkDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-dark-950/70 backdrop-blur-sm" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseFocus();
          }}
          className="fixed left-1/2 top-1/2 z-[101] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl border border-success-500/30 bg-dark-900 p-5 shadow-2xl focus:outline-none"
        >
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label={t('common.close')}
              className="absolute right-3 top-3 rounded-lg p-2 text-dark-400 hover:bg-dark-800 hover:text-dark-100"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </Dialog.Close>
          <div className="flex items-center gap-2 pr-8 text-success-400">
            <CheckIcon className="h-5 w-5 shrink-0" />
            <Dialog.Title className="text-lg font-semibold">
              {t('balance.paymentReady')}
            </Dialog.Title>
          </div>
          <Dialog.Description className="text-sm text-dark-400">
            {t('balance.clickToOpenPayment')}
          </Dialog.Description>
          <button
            type="button"
            onClick={onOpenPayment}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-success-500 px-3 py-3 font-bold text-white transition-colors hover:bg-success-400 active:bg-success-600"
          >
            <ExternalLinkIcon className="h-5 w-5 shrink-0" />
            <span>{t('balance.openPaymentPage')}</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 rounded-lg border border-dark-700/50 bg-dark-800/70 px-3 py-2">
              <p className="truncate text-xs text-dark-500">{paymentUrl}</p>
            </div>
            <button
              type="button"
              onClick={onCopy}
              aria-label={copied ? t('common.copied') : t('common.copy')}
              className={`shrink-0 rounded-lg p-3 transition-colors ${
                copied
                  ? 'bg-success-500/20 text-success-400'
                  : 'bg-dark-800/70 text-dark-400 hover:bg-dark-700 hover:text-dark-200'
              }`}
            >
              {copied ? <CheckIcon className="h-5 w-5" /> : <CopyIcon className="h-5 w-5" />}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
