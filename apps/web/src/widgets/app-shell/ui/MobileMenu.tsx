'use client';

import { Drawer, IconButton } from '@pharmacy/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { FontScaleControl } from '@/features/font-scale';
import { useNavCounters } from '../model/use-nav-counters';
import { hasNavAttention, SidebarNav } from './SidebarNav';

/**
 * The menu of the phone layout (ADR-0007, amendment 2026-11-10): below the tablet breakpoint the sidebar is hidden and
 * this button of the top bar opens the same menu in a drawer, with the font size control at its foot. The button shows
 * a dot when an item has waiting work. Choosing an item, a new route, Esc and the backdrop close the drawer.
 */
export function MobileMenu() {
  const t = useTranslations('shell');
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const pathname = usePathname();
  const { data: session } = useSession();
  // the sidebar (mounted, hidden) owns the refresh of the counters
  const { counters, storeId } = useNavCounters({ refresh: false });
  const attention = hasNavAttention(session, counters);

  // a new route closes the menu: a link chosen elsewhere, the browser back button
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // only the button is hidden from the tablet breakpoint up: an open drawer under a display:none ancestor would stay
  // modal but invisible after a phone turns to landscape (wider than 768 px), and nothing could be tapped
  return (
    <>
      <IconButton
        icon="menu"
        label={attention ? t('menuAttention') : t('menu')}
        variant="surface"
        indicator={attention}
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen(true)}
        className="tablet:hidden"
      />
      <Drawer
        id={drawerId}
        open={open}
        onClose={() => setOpen(false)}
        label={t('navLabel')}
        closeLabel={t('closeMenu')}
      >
        <nav
          aria-label={t('navLabel')}
          className="flex flex-col gap-4 px-3 pb-4"
        >
          <SidebarNav
            counters={counters}
            storeId={storeId}
            onNavigate={() => setOpen(false)}
          />
          <div className="border-t border-border pt-4">
            <FontScaleControl />
          </div>
        </nav>
      </Drawer>
    </>
  );
}
