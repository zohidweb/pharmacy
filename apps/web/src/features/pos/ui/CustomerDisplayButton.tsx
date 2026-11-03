'use client';

import { Button } from '@pharmacy/ui';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { routes } from '@/shared/config';
import { displaySupported } from '@/shared/lib/customer-display';

/** The name of the display window: one per POS browser. */
const DISPLAY_WINDOW = 'ph-customer-display';

/** True when the window already shows the display of `target` (same origin, page and terminal). */
function showsDisplay(opened: Window, target: URL): boolean {
  try {
    const current = new URL(opened.location.href);
    const page = (url: URL) => url.pathname.replace(/(\.html|\/)$/, '');
    return (
      current.origin === target.origin &&
      page(current) === page(target) &&
      current.searchParams.get('terminal') ===
        target.searchParams.get('terminal')
    );
  } catch {
    // another origin: its location cannot be read, only replaced
    return false;
  }
}

/**
 * «Экран покупателя» in the header of the POS (spec 2026-11-03-pos-store-ideas, D1): opens the display of this terminal
 * in its own window, to be moved to the buyer's monitor. A display that is already open is only raised: reloading it
 * would take it out of full screen. A blocked pop-up is reported to the cashier.
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
        // an empty url finds the window of this name without navigating it; a new one is about:blank
        const opened = window.open('', DISPLAY_WINDOW, 'popup');
        if (!opened) {
          onBlocked();
          return;
        }
        const target = new URL(
          routes.customerDisplay(terminalId),
          window.location.href,
        );
        if (!showsDisplay(opened, target)) opened.location.href = target.href;
        opened.focus();
      }}
    >
      {t('open')}
    </Button>
  );
}
