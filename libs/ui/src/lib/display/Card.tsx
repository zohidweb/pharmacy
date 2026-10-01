import type { ElementType, ReactNode } from 'react';
import { cx } from '../cx';

export interface CardProps {
  /** Landmark-free container by default; use "section" with a heading inside. */
  as?: Extract<ElementType, 'div' | 'section' | 'article' | 'aside'>;
  /** "none" for cards whose content (tables, lists) runs edge to edge. */
  padding?: 'default' | 'none';
  children: ReactNode;
  /** Layout only. */
  className?: string;
  'aria-labelledby'?: string;
}

export function Card({
  as: Element = 'div',
  padding = 'default',
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <Element
      className={cx(
        'min-w-0 rounded-(--ph-card-radius) bg-surface shadow-(--ph-card-shadow)',
        padding === 'default' && 'p-(--ph-card-padding)',
        padding === 'none' && 'overflow-hidden',
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  /** Buttons, chips or links aligned to the end. */
  actions?: ReactNode;
  /** Heading level inside the page outline (default h2). */
  level?: 2 | 3;
  /** Adds the card padding when the card itself uses padding="none". */
  inset?: boolean;
  /** Layout only. */
  className?: string;
}

export function CardHeader({
  title,
  titleId,
  description,
  actions,
  level = 2,
  inset = false,
  className,
}: CardHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div
      className={cx(
        'flex flex-wrap items-start justify-between gap-3',
        inset ? 'p-(--ph-card-padding) pb-4' : 'mb-4',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading id={titleId} className="text-md font-bold text-fg">
          {title}
        </Heading>
        {description && <p className="text-xs text-fg-subtle">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
