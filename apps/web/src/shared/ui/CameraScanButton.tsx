'use client';

import { IconButton } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useCameraAvailable } from '@/shared/lib/camera-scan';
import { CameraScanDialog } from './CameraScanDialog';

export interface CameraScanButtonProps {
  /** The handler of the USB scanner of the same field (spec D31). */
  onScan: (code: string) => void;
  disabled?: boolean;
}

/**
 * «Камера» next to a field that takes a scan (ADR-0025): nothing without a camera or out of a secure context. The icon
 * is `scan-barcode` — the kit has no camera icon (plan 2026-11-04-pos-store-ideas-pr4, R1).
 */
export function CameraScanButton({ onScan, disabled = false }: CameraScanButtonProps) {
  const t = useTranslations('camera');
  const available = useCameraAvailable();
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return (
    <>
      <IconButton
        icon="scan-barcode"
        label={t('open')}
        iconSize="sm"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      {open && (
        <CameraScanDialog
          open
          onClose={() => setOpen(false)}
          onScan={onScan}
        />
      )}
    </>
  );
}
