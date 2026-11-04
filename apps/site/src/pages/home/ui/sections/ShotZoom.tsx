'use client';

/*
 * The product screen of a «Возможности» tile as a button that enlarges it (spec 2026-11-04-public-site-home-polish, H7).
 * A click, Enter or Space opens the kit's `Dialog` (native <dialog> + showModal(): Esc, a click on the backdrop and the
 * focus trap come from the browser) with the same file at the dialog's full width. The dialog mounts its content only
 * while open, so the large <img loading="lazy"> is requested on the first opening, not with the page. Focus returns to
 * the button on close (the kit does it; the explicit focus covers Safari, where a clicked button takes no focus).
 *
 * The tile crops the screen, so the button keeps the screen's own box and `className` goes on the <img>. The round badge
 * of the corner is drawn by the tile (a decorative sibling that lets clicks through); the texts arrive finished.
 */
import { useRef, useState } from 'react';
import { Dialog } from '@pharmacy/ui';

export interface ShotZoomProps {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** The tile's title: the dialog's heading. */
  title: string;
  /** `open` is the button's accessible name («Увеличить снимок: …»), `close` the dialog's close button. */
  labels: { open: string; close: string };
  /** Classes of the tile's <img> (its box inside the tile). */
  className?: string;
}

export function ShotZoom({
  src,
  width,
  height,
  alt,
  title,
  labels,
  className,
}: ShotZoomProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={labels.open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="block h-full cursor-zoom-in rounded-site-card"
      >
        {/* a plain <img>: no next/image on the site (ADR-0023) */}
        <img
          src={src}
          width={width}
          height={height}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={className}
        />
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          button.current?.focus();
        }}
        title={title}
        closeLabel={labels.close}
        size="xl"
      >
        <img
          src={src}
          width={width}
          height={height}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full rounded-site-card border border-site-shot"
        />
      </Dialog>
    </>
  );
}
