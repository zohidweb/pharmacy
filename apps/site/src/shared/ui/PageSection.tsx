import { cx } from '@pharmacy/ui';
import type { ReactNode } from 'react';

export interface PageSectionProps {
  /** Anchor of the section (`features` → `/#features`); the heading gets `<id>-title`. */
  id: string;
  title: string;
  subtitle?: string;
  /** `surface` — white band, `page` — the page background. */
  tone?: 'surface' | 'page';
  children: ReactNode;
}

const tones = { surface: 'bg-surface', page: 'bg-bg' } as const;

/** A full-width band of a site page with a heading; its content is a size container for @-variants. */
export function PageSection({
  id,
  title,
  subtitle,
  tone = 'page',
  children,
}: PageSectionProps) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx('scroll-mt-4', tones[tone])}
    >
      <div className="@container mx-auto flex w-full max-w-(--ph-size-dialog-xl) flex-col gap-8 px-4 py-12">
        <header className="flex max-w-(--ph-size-dialog-lg) flex-col gap-2">
          <h2 id={headingId} className="text-2xl font-bold tracking-tight">
            {title}
          </h2>
          {subtitle && <p className="text-fg-muted">{subtitle}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}
