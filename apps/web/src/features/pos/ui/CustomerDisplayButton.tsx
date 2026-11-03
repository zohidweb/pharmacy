'use client';

import { Button } from '@pharmacy/ui';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { routes } from '@/shared/config';
import { displaySupported } from '@/shared/lib/customer-display';

/**
 * «Экран покупателя» in the header of the POS (spec 2026-11-03-pos-store-ideas, D1): opens the display of this terminal
 * in its own window, to be moved to the buyer's monitor. A blocked pop-up is reported to the cashier.
 */
export function CustomerDisplayButton({
  terminalId,
  onBlocked,
}: {
  terminalId: string;
  onBlocked: () => void;
}) {
  const t = useTranslations('pos.customerDisplay');
  // known only in the browser: the static pre-render shows no button
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(displaySupported()), []);
  if (!supported) return null;
  return (
    <Button
      variant="secondary"
      iconStart="monitor"
      onClick={() => {
        const opened = window.open(
          routes.customerDisplay(terminalId),
          'ph-customer-display',
          'popup',
        );
        if (!opened) onBlocked();
      }}
    >
      {t('open')}
    </Button>
  );
}
