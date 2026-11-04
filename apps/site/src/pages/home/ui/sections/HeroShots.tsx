/*
 * The product screen of the first screen (spec 2026-11-04-public-site-home-polish, H1; it replaces the three tilted
 * screens of spec 4.4, 4.5, п. 2 and amendment 4.4, п. 2): one till screen, large enough to read the search, the first
 * rows of the catalogue and the receipt. From 1024 px it is wider than its column (w-site-hero-shot, 150 % of it: about
 * 990 px at 1440), starts at the column's left edge and runs past the panel's right edge, which clips it (the panel has
 * `overflow-x-clip`); it still hangs 64 px below the panel. On a phone it is the whole picture in the width of the
 * content. It comes in with the CSS entrance (R1) and, from 1024 px, drifts a little with the scroll (Parallax, speed
 * 0.1, no turn); with reduce and on a phone it stands. The layers do not fight: Parallax (shift) → entrance. On the dark
 * panel the screen has no border, only the shadow (L3). A server component: Parallax is its own client leaf.
 */
import { Parallax } from '@/shared/ui/motion';

/** Real pixel size of the WebP file (CLS). A screen of apps/web on its mocks: synthetic data only. */
const SHOT = { src: '/images/pos.webp', width: 1600, height: 1100 } as const;

export interface HeroShotsProps {
  /** The text alternative of the screen, in the page language. */
  alt: string;
}

export function HeroShots({ alt }: HeroShotsProps) {
  return (
    // From 1024 px the item sits at the bottom of the panel and hangs 64 px below its lower edge (the negative margin:
    // the row does not grow, the section keeps that much room under the panel); on a phone it stays inside. A grid item
    // wider than its track overflows to the right, which is the point: justify-self-start keeps its left edge on the
    // column and `md:max-w-none` lifts the phone cap.
    <div className="relative mx-auto w-full max-w-(--ph-size-dialog-lg) md:mx-0 md:-mb-16 md:w-site-hero-shot md:max-w-none md:self-end md:justify-self-start">
      <Parallax speed={0.1}>
        <div className="site-enter site-enter-delay-2 rounded-site-card shadow-shot">
          {/* a plain <img>: no next/image on the site (ADR-0023) */}
          <img
            src={SHOT.src}
            width={SHOT.width}
            height={SHOT.height}
            alt={alt}
            fetchPriority="high"
            decoding="async"
            className="block h-auto w-full rounded-site-card"
          />
        </div>
      </Parallax>
    </div>
  );
}
