'use client';

/*
 * The <header> element of the site header (spec 4.5, п. 1; R5 without the library, controller ruling on Task 3). After
 * 24 px of scroll it gets `data-scrolled`, and CSS shows its background by the attribute. The scroll is seen by an
 * IntersectionObserver on a 1 px sentinel 24 px below the top of the page: when the sentinel leaves the viewport the
 * attribute is written straight to the element. No scroll listener, no React render per frame, no `motion`: the header
 * is on every page, and pages without their own animation load no motion chunk. Without JavaScript the header keeps
 * its top style. Nothing moves here: the background only fades (CSS opacity, none with reduce).
 *
 * It also closes the phone menu (<details>) the way people expect from a full-screen menu: on a link, so a same-page
 * anchor (#contacts, #features on the home page) does not stay covered by it; on Escape, back to its button, from
 * anywhere while it is open (a click on blank panel space moves the focus to the body, out of the header); and when the
 * focus leaves the header, so the keyboard never lands on the page hidden under the panel.
 * Without JavaScript the menu still opens and closes by its button.
 */
import { useEffect, useRef, type ReactNode } from 'react';

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
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = ref.current;
    const mark = sentinel.current;
    if (!header || !mark) return;
    // the first callback reports the current state too: a page opened in the middle (reload, back) is marked at once
    const observer = new IntersectionObserver(([entry]) => {
      header.toggleAttribute('data-scrolled', !entry.isIntersecting);
    });
    observer.observe(mark);
    return () => observer.disconnect();
  }, []);

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
    // Escape is heard on the whole document only while the menu is open; `toggle` does not bubble, so it is caught
    const onToggle = () => {
      if (openMenuOf(header)) document.addEventListener('keydown', onKeyDown);
      else document.removeEventListener('keydown', onKeyDown);
    };
    // Tab past the last item would focus the page under the panel, out of sight: the menu closes instead
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || header.contains(next)) return;
      const menu = openMenuOf(header);
      if (menu) menu.open = false;
    };
    header.addEventListener('click', onClick);
    header.addEventListener('toggle', onToggle, true);
    header.addEventListener('focusout', onFocusOut);
    onToggle(); // a menu opened before hydration
    return () => {
      header.removeEventListener('click', onClick);
      header.removeEventListener('toggle', onToggle, true);
      header.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <>
      {/* 24 px from the top of the document (the body is not positioned): out of view = scrolled past 24 px */}
      <div
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute top-6 left-0 h-px w-px"
      />
      <header ref={ref} className={className}>
        {children}
      </header>
    </>
  );
}
