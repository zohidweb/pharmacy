'use client';

import { buttonClassName, cx } from '@pharmacy/ui';
import { m, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SPRING } from './transitions';

const MotionLink = m.create(Link);

export interface PressableLinkProps {
  href: string;
  children: ReactNode;
  /**
   * `primary` — the mint button; `secondary` — the kit's outline button, its border is the site line in the site
   * theme.
   */
  variant: 'primary' | 'secondary';
  size?: 'md' | 'lg';
  /** Layout only (margins, grid placement). */
  className?: string;
}

/** A link that looks like a kit button and answers the pointer: lifts on hover, gives on press (spec 4.7). */
export function PressableLink({
  href,
  children,
  variant,
  size = 'md',
  className,
}: PressableLinkProps) {
  const reduce = useReducedMotion() ?? false;
  return (
    <MotionLink
      href={href}
      className={cx(buttonClassName({ variant, size }), className)}
      whileHover={reduce ? undefined : { y: -1 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={SPRING}
    >
      {children}
    </MotionLink>
  );
}
