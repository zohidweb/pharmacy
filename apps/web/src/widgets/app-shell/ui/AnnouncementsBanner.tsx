'use client';

import type { TenantAnnouncement } from '@pharmacy/shared-dto';
import { Alert, Button } from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest } from '@/shared/api';

const DISMISSED_KEY = 'pharmacy-web-dismissed-announcements';
/** The height the banner takes; the POS subtracts it (`--ph-pos-height`), so «Оплатить» stays on screen. */
const HEIGHT_VAR = '--ph-announcements-height';

/** Ids the viewer closed in this browser — a per-viewer convenience; storage may be unavailable. */
function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: readonly string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // no storage: the banner comes back on the next load
  }
}

/**
 * Announcements of the platform (spec 2026-10-19-operator-notifications, N14): one line per announcement
 * on every screen of the shell, the POS included; «Подробнее» opens the text, «Закрыть» hides it in this
 * browser. Not asked for on an offline store — the announcements come only from the cloud.
 */
export function AnnouncementsBanner() {
  const t = useTranslations('shell.announcement');
  const deployment = useQuery({
    queryKey: ['deployment'],
    queryFn: ({ signal }) => apiRequest('deployment.get', { signal }),
    staleTime: Infinity,
  });
  const cloud =
    deployment.isSuccess && deployment.data.kind !== 'offline-store';
  const announcements = useQuery({
    queryKey: ['announcements'],
    queryFn: ({ signal }) => apiRequest('announcements.list', { signal }),
    enabled: cloud,
    refetchInterval: 600_000,
    refetchOnWindowFocus: true,
  });
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const shown = (announcements.data ?? []).filter(
    (item: TenantAnnouncement) => !dismissed.includes(item.id),
  );

  // the POS has a fixed height under the top bar: it subtracts the height of the banner (final review
  // I1); computed geometry through a CSS variable, 0 without a banner
  useEffect(() => {
    const root = document.documentElement;
    const node = ref.current;
    if (!node) {
      root.style.removeProperty(HEIGHT_VAR);
      return;
    }
    const update = () =>
      root.style.setProperty(
        HEIGHT_VAR,
        `${node.getBoundingClientRect().height}px`, // ignore-design: measured height of the banner
      );
    update();
    if (typeof ResizeObserver === 'undefined') {
      return () => root.style.removeProperty(HEIGHT_VAR);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [shown.length]);

  if (shown.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div ref={ref} className="flex flex-col gap-2 px-6 pt-4">
      {shown.map((item) => (
        <Alert key={item.id} tone="info">
          <div className="flex flex-wrap items-center gap-x-4">
            <span className="font-medium">{item.title}</span>
            <Button
              variant="tertiary"
              aria-expanded={open === item.id}
              onClick={() => setOpen(open === item.id ? null : item.id)}
            >
              {open === item.id ? t('less') : t('more')}
            </Button>
            <Button variant="tertiary" onClick={() => dismiss(item.id)}>
              {t('dismiss')}
            </Button>
          </div>
          {open === item.id && <p className="mt-1">{item.text}</p>}
        </Alert>
      ))}
    </div>
  );
}
