'use client';

import { useTranslations } from 'use-intl';
import { useNavCounters } from '../model/use-nav-counters';
import { SidebarNav } from './SidebarNav';

/**
 * Menu of the screens the employee's role opens (ADR-0018), at the side of the shell. Below the tablet breakpoint it
 * is hidden — the same menu opens from the button of the top bar (MobileMenu; ADR-0007, amendment 2026-11-10) — but
 * stays mounted: it owns the refresh of the menu counters.
 */
export function Sidebar() {
  const t = useTranslations();
  const { counters, storeId } = useNavCounters();

  return (
    <nav
      aria-label={t('shell.navLabel')}
      className="sticky top-topbar flex h-(--ph-shell-body-height) w-sidebar shrink-0 flex-col gap-4 overflow-y-auto border-e border-border bg-surface px-3 py-4 max-tablet:hidden"
    >
      <SidebarNav counters={counters} storeId={storeId} />
    </nav>
  );
}
