'use client';

/*
 * The product screen of a «Возможности» tile as a button that enlarges it (spec 2026-11-04-public-site-home-polish, H7).
 * A click, Enter or Space opens the kit's `Dialog` (native <dialog> + showModal(): Esc, a click on the backdrop and the
 * focus trap come from the browser) with the same file at the dialog's full width. The dialog mounts its content only
 * while open, so the large <img loading="lazy"> is requested on the first opening, not with the page. Focus returns to
 * the button on close: the kit focuses the element that had focus at showModal(), and the click handler gives the
 * button focus first, because Safari does not focus a button on a mouse click (it would return to <body>).
 *
 * The tile crops the screen, so the button keeps the screen's own box and `className` goes on the <img>; the focus ring
 * is drawn by the tile (`has-focus-visible`, Features), since the button's own outline would be cropped. The round badge
 * of the corner is drawn by the tile (a decorative sibling that lets clicks through); the texts arrive finished.
 *
 * Below 1024 px the tile shows `phone`, a fragment of the same screen at its own resolution (spec
 * 2026-11-10-public-site-mobile, M2): a <picture> whose source for 1024 px and wider is the whole screen; the dialog
 * always shows the whole screen.
 */
import { useState } from 'react';
import { Dialog } from '@pharmacy/ui';

/** A WebP file with its real pixel size (CLS). */
export interface ShotFile {
  src: string;
  width: number;
  height: number;
}

export interface ShotZoomProps extends ShotFile {
  /** The fragment the tile shows below 1024 px. */
  phone: ShotFile;
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
  phone,
  alt,
  title,
  labels,
  className,
}: ShotZoomProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={labels.open}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
        // a button shrinks to its content even as a block: on a phone it takes the tile's width (the fragment fills it),
        // from 1024 px the width of the screen it holds
        className="block h-full w-full cursor-zoom-in rounded-site-card focus-visible:outline-hidden md:w-auto"
      >
        {/* a plain <picture>: no next/image on the site (ADR-0023); each source carries its own size */}
        <picture>
          <source
            media="(min-width: 64rem)"
            srcSet={src}
            width={width}
            height={height}
          />
          <img
            src={phone.src}
            width={phone.width}
            height={phone.height}
            alt={alt}
            loading="lazy"
            decoding="async"
            className={className}
          />
        </picture>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        closeLabel={labels.close}
        size="xl"
        // a picture: centred on a phone too, not at the top of a white screen
        fullScreenOnPhone={false}
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
