/*
 * Возможности (amendment 2026-11-02-public-site-light-panels 4.4, п. 5): exactly six tiles of different sizes, no empty
 * cell. From 1024 px a grid of six columns: the till is the large tile on the left (four columns, three rows), batches
 * and expiry dates, purchasing and prices stack in the two columns on its right, transfers and reports share the last
 * row. On a phone one column in the same order. The tiles are light surfaces with a line, except prices (a mint block)
 * and reports (a dark block, no line). A product screen sits in the lower right corner of its tile and the tile's edge
 * crops it. Only what works in the cloud pilot: no 1C export, no offline stores (spec 2, anti-goals).
 *
 * The tiles appear one after another (RevealGroup). Under the pointer the product screen of a tile rises by 4 px: a CSS
 * transform, only where the device can hover and without reduce (`motion-safe:group-hover:`).
 *
 * A product screen is a button that enlarges it in a dialog (spec 2026-11-04-public-site-home-polish, H7; ShotZoom), with
 * a round zoom badge in the corner of the window.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx, Icon, type IconName } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';
import { contentClassName, panelBodyClassName } from '@/shared/ui';
import { RevealGroup, RevealItem } from '@/shared/ui/motion';
import { ShotZoom } from './ShotZoom';

/** Real pixel sizes of the WebP files (CLS). Screens of apps/web on its mocks: synthetic data only. */
const SHOTS = {
  pos: { src: '/images/pos.webp', width: 1600, height: 1100 },
  stock: { src: '/images/stock-batches.webp', width: 1600, height: 1000 },
  transfers: { src: '/images/transfers.webp', width: 1600, height: 1000 },
} as const;

type ShotKey = keyof typeof SHOTS;

/**
 * How a screen sits in its tile: the least window (its aspect; the window grows with a tile the grid makes taller) and
 * the screen's height against the window. The screen is always taller than the window, so its lower edge and its right
 * edge run past the tile and the tile crops them; a narrow tile shows the screen larger, so its corner (the page title,
 * the first rows) stays readable.
 */
const FRAMES = {
  wide: { view: 'aspect-4/3', screen: 'h-5/4' },
  half: { view: 'aspect-2/1', screen: 'h-3/2' },
  narrow: { view: 'aspect-16/9', screen: 'h-8/5' },
} as const;

type Tile =
  | {
      key: 'pos' | 'stock' | 'transfers';
      shot: ShotKey;
      frame: keyof typeof FRAMES;
      span: string;
    }
  | {
      key: 'purchasing' | 'pricing' | 'reports';
      icon: IconName;
      span: string;
    };

/** The colour panel of a tile; the others are the light surface with a line. */
const SURFACES: Partial<Record<Tile['key'], 'mint' | 'dark'>> = {
  pricing: 'mint',
  reports: 'dark',
};

// the order is the reading order on a phone and the placement order of the grid from 1024 px
const TILES: readonly Tile[] = [
  {
    key: 'pos',
    shot: 'pos',
    frame: 'wide',
    span: 'md:col-span-4 md:row-span-3',
  },
  { key: 'stock', shot: 'stock', frame: 'narrow', span: 'md:col-span-2' },
  { key: 'purchasing', icon: 'truck', span: 'md:col-span-2' },
  { key: 'pricing', icon: 'tag', span: 'md:col-span-2' },
  { key: 'transfers', shot: 'transfers', frame: 'half', span: 'md:col-span-3' },
  { key: 'reports', icon: 'download', span: 'md:col-span-3' },
];

function TileShot({
  shot,
  frame,
  alt,
  title,
  labels,
}: {
  shot: ShotKey;
  frame: keyof typeof FRAMES;
  alt: string;
  title: string;
  labels: { open: string; close: string };
}) {
  const { src, width, height } = SHOTS[shot];
  const { view, screen } = FRAMES[frame];
  return (
    // The window fills the rest of the tile. The screen starts 24 px (32 px from 1024 px) from the left edge and runs
    // past the right and the lower edges: the tile crops it there (the shots are viewport crops, as on the first
    // screen). The 8 px above the screen leave room for the 4 px rise.
    <div className={cx('relative grow', view)}>
      <div className="absolute inset-y-0 left-6 pt-2 transition-transform duration-(--ph-duration-slow) ease-out motion-safe:group-hover:-translate-y-1 md:left-8">
        <ShotZoom
          src={src}
          width={width}
          height={height}
          alt={alt}
          title={title}
          labels={labels}
          className={cx(
            'block w-auto max-w-none rounded-site-card border border-site-shot shadow-shot',
            screen,
          )}
        />
      </div>
      {/* the badge sits in the corner of the window (not of the cropped screen) and lets clicks through to the screen */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-fg text-bg"
      >
        <Icon name="maximize" size="sm" />
      </span>
    </div>
  );
}

export function Features({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="scroll-mt-4"
    >
      <div
        className={cx(
          contentClassName,
          panelBodyClassName,
          'flex flex-col gap-10',
        )}
      >
        <header className="flex max-w-(--ph-size-dialog-lg) flex-col gap-4">
          <h2 id="features-title" className="text-section text-balance">
            {t('home.features.title')}
          </h2>
          <p className="text-lead text-fg-muted">
            {t('home.features.subtitle')}
          </p>
        </header>
        {/* a column of tiles on a phone is far taller than the screen: it plays as soon as it enters */}
        <RevealGroup as="ul" amount={0} className="grid gap-4 md:grid-cols-6">
          {TILES.map((tile) => {
            const surface = SURFACES[tile.key];
            return (
              // the item is the grid cell (it appears with the others); the tile inside carries the fill
              <RevealItem
                key={tile.key}
                as="li"
                className={cx('group flex', tile.span)}
              >
                <div
                  data-surface={surface}
                  className={cx(
                    'flex flex-1 flex-col overflow-hidden rounded-site-card',
                    !surface && 'border border-site-line bg-surface',
                  )}
                >
                  {'shot' in tile ? (
                    <>
                      <div className="flex flex-col gap-3 p-6 md:p-8">
                        <h3 className="text-2xl font-bold tracking-tight">
                          {t(`home.features.items.${tile.key}.title`)}
                        </h3>
                        <p className="max-w-(--ph-size-dialog-md) text-lead text-fg-muted">
                          {t(`home.features.items.${tile.key}.text`)}
                        </p>
                      </div>
                      <TileShot
                        shot={tile.shot}
                        frame={tile.frame}
                        alt={t(`home.features.items.${tile.key}.shot`)}
                        title={t(`home.features.items.${tile.key}.title`)}
                        labels={{
                          open: t('home.features.zoom', {
                            title: t(`home.features.items.${tile.key}.title`),
                          }),
                          close: t('home.features.close'),
                        }}
                      />
                    </>
                  ) : (
                    <div className="flex flex-1 flex-col gap-8 p-6 md:p-8">
                      <span className="text-accent-site">
                        <Icon name={tile.icon} size="xl" />
                      </span>
                      <div className="mt-auto flex flex-col gap-3">
                        <h3 className="text-2xl font-bold tracking-tight">
                          {t(`home.features.items.${tile.key}.title`)}
                        </h3>
                        <p className="max-w-(--ph-size-dialog-md) text-lead text-fg-muted">
                          {t(`home.features.items.${tile.key}.text`)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
