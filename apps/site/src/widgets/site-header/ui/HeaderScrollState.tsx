'use client';

/*
 * The <header> element of the site header (spec 4.5, п. 1; R5). After 24 px of scroll it gets `data-scrolled`, and CSS
 * shows its background by the attribute: `useScroll` + `useMotionValueEvent` write the attribute straight to the
 * element, with no scroll listener and no React render per frame. Nothing moves here: the background only fades
 * (CSS opacity, none with reduce), so there is no motion to switch off.
 *
 * It also closes the phone menu (<details>) the way people expect from a full-screen menu: on a link, so a same-page
 * anchor (#contacts, #features on the home page) does not stay covered by it; on Escape, back to its button; and when
 * the focus leaves the header, so the keyboard never lands on the page hidden under the panel.
 * Without JavaScript the menu still opens and closes by its button.
 */
import { useMotionValueEvent, useScroll } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

/** Scroll, px, after which the header gets its background. */
const SCROLLED_AFTER = 24;

export interface HeaderScrollStateProps {
  className?: string;
  children: ReactNode;
}

function openMenuOf(header: HTMLElement): HTMLDetailsElement | null {
  return header.querySelector<HTMLDetailsElement>('details[open]');
}

export function HeaderScrollState({
  className,
  children,
}: HeaderScrollStateProps) {
  const ref = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  const { scrollY } = useScroll();

  const mark = (y: number) => {
    const next = y > SCROLLED_AFTER;
    if (next === scrolled.current) return;
    scrolled.current = next;
    ref.current?.toggleAttribute('data-scrolled', next);
  };

  // a page opened in the middle (reload, back) is already scrolled before the first change
  useEffect(() => {
    const y = scrollY.get();
    scrolled.current = y > SCROLLED_AFTER;
    ref.current?.toggleAttribute('data-scrolled', scrolled.current);
  }, [scrollY]);
  useMotionValueEvent(scrollY, 'change', mark);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a[href]');
      link?.closest('details[open]')?.removeAttribute('open');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const menu = openMenuOf(header);
      if (!menu) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };
    // Tab past the last item would focus the page under the panel, out of sight: the menu closes instead
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || header.contains(next)) return;
      const menu = openMenuOf(header);
      if (menu) menu.open = false;
    };
    header.addEventListener('click', onClick);
    header.addEventListener('keydown', onKeyDown);
    header.addEventListener('focusout', onFocusOut);
    return () => {
      header.removeEventListener('click', onClick);
      header.removeEventListener('keydown', onKeyDown);
      header.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return (
    <header ref={ref} className={className}>
      {children}
    </header>
  );
}
