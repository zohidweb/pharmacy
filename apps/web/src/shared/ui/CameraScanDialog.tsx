'use client';

import { Alert, Button, Dialog } from '@pharmacy/ui';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { type CameraScanStatus, useCameraScan } from '@/shared/lib/camera-scan';

export interface CameraScanDialogProps {
  open: boolean;
  onClose(): void;
  /** The first code read; the window is already closed when it is called. */
  onScan(code: string): void;
}

const errorKey: Partial<
  Record<CameraScanStatus, 'denied' | 'noCamera' | 'busy' | 'timeout' | 'failed'>
> = {
  denied: 'denied',
  no_camera: 'noCamera',
  busy: 'busy',
  timeout: 'timeout',
  failed: 'failed',
};

/**
 * The camera window (spec 2026-11-03-pos-store-ideas, D32–D33; ADR-0025): the video of the rear camera under a frame;
 * the first code closes the window and goes to the handler of the field, as a scan of the USB scanner. A hidden tab
 * closes it too: the camera is never kept by a page nobody sees.
 */
export function CameraScanDialog({ open, onClose, onScan }: CameraScanDialogProps) {
  const t = useTranslations('camera');
  const { status, videoRef, torch, retry } = useCameraScan({
    active: open,
    onCode: (code) => {
      onClose();
      onScan(code);
    },
  });

  useEffect(() => {
    if (!open) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onClose();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [open, onClose]);

  const error = errorKey[status];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('title')}
      closeLabel={t('close')}
      icon="scan-barcode"
      size="md"
      footer={
        <>
          {torch.available && !error && (
            <Button
              variant="secondary"
              aria-pressed={torch.on}
              onClick={torch.toggle}
            >
              {t('torch')}
            </Button>
          )}
          {error && status !== 'no_camera' && (
            <Button variant="secondary" onClick={retry}>
              {t('retry')}
            </Button>
          )}
          <Button onClick={onClose}>{t('close')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative aspect-video overflow-hidden rounded-md bg-inverse">
          <video
            ref={videoRef}
            className="size-full object-cover"
            playsInline
            muted
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-12 inset-y-10 rounded-md border-2 border-primary"
          />
        </div>
        {error ? (
          <Alert tone="danger" live="assertive">
            {t(error)}
          </Alert>
        ) : (
          <p role="status" className="text-sm text-fg-muted">
            {status === 'starting' ? t('starting') : t('hint')}
          </p>
        )}
      </div>
    </Dialog>
  );
}
