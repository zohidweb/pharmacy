'use client';

/*
 * Three product screens of the first screen (spec 4.4, 4.5, п. 2; amendment 4.4, п. 2): the till in front, stock by
 * batches and the sales report behind it, shifted. They come in one after another with the CSS entrance (R1); from
 * 1024 px they part at their own speed while the page scrolls and straighten from their tilt (Parallax, L7), never with
 * reduce. Each layer moves on its own element: Parallax (shift and tilt) → entrance, so the transforms never fight. On
 * the dark panel the screens have no border, only the shadow (L3). The shots are viewport crops; their lower edge fades
 * instead of ending in a cut.
 */
import { cx } from '@pharmacy/ui';
import { Parallax } from '@/shared/ui/motion';

/** Real pixel sizes of the WebP files (CLS). Screens of apps/web on its mocks: synthetic data only. */
const SHOTS = {
  stock: { src: '/images/stock-batches.webp', width: 1600, height: 1000 },
  report: { src: '/images/sales-report.webp', width: 1600, height: 1000 },
  pos: { src: '/images/pos.webp', width: 1600, height: 1100 },
} as const;

type ShotKey = keyof typeof SHOTS;

export interface HeroShotsProps {
  /** Text alternatives of the screens, in the page language. */
  alts: Record<ShotKey, string>;
}

interface ShotProps {
  shot: ShotKey;
  alt: string;
  /** Parallax speed: the farther the screen, the more it lags behind the scroll. */
  speed: number;
  /** Place in the stack (absolute position and width inside the 5 : 4 frame). */
  place: string;
  /** Entrance delay class. */
  enter: string;
  /** Tilt in degrees before the page scrolls (L7): the farther the screen, the more it leans. */
  tilt: number;
  priority?: boolean;
}

function Shot({ shot, alt, speed, place, enter, tilt, priority }: ShotProps) {
  const { src, width, height } = SHOTS[shot];
  return (
    <Parallax speed={speed} tilt={tilt} className={cx('absolute', place)}>
      <div className={cx('site-enter', enter)}>
        <div className="rounded-site-card shadow-shot">
          {/* a plain <img>: no next/image on the site (ADR-0023) */}
          <img
            src={src}
            width={width}
            height={height}
            alt={alt}
            {...(priority
              ? { fetchPriority: 'high' as const }
              : { loading: 'lazy' as const })}
            decoding="async"
            className="block h-auto w-full rounded-site-card mask-b-from-70%"
          />
        </div>
      </div>
    </Parallax>
  );
}

export function HeroShots({ alts }: HeroShotsProps) {
  return (
    // A square frame. From 1024 px it sits at the bottom of the panel and hangs 64 px below its lower edge (the negative
    // margin: the row does not grow, the section keeps that much room under the panel); on a phone it stays inside. A
    // grid item with an aspect ratio does not stretch by default (nor with an auto margin), hence justify-self and mx-0.
    <div className="relative mx-auto aspect-square w-full max-w-(--ph-size-dialog-lg) md:mx-0 md:-mb-16 md:w-auto md:max-w-none md:self-end md:justify-self-stretch">
      <Shot
        shot="stock"
        alt={alts.stock}
        speed={0.15}
        place="top-0 left-0 w-3/4"
        enter="site-enter-delay-3"
        tilt={-6}
      />
      <Shot
        shot="report"
        alt={alts.report}
        speed={0.1}
        place="top-1/8 right-0 w-3/4"
        enter="site-enter-delay-4"
        tilt={-4}
      />
      <Shot
        shot="pos"
        alt={alts.pos}
        speed={0.05}
        place="bottom-0 left-1/12 w-5/6"
        enter="site-enter-delay-2"
        tilt={-2}
        priority
      />
    </div>
  );
}
