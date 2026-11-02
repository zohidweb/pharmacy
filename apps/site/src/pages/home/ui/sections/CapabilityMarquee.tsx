/*
 * The capability line of the home page (spec 4.5, п. 3; R7), the only one on the site: eight capabilities of the cloud
 * pilot (no 1C export, no offline stores) move slowly to the left and stop under the pointer. Pure CSS
 * (`.site-marquee` in site-theme.css), no JavaScript. The track holds the list twice so the loop has no seam; the copy
 * is hidden from assistive technology. With reduce the copy is gone and the list wraps in place, still.
 */
import type { UiLocale } from '@pharmacy/shared-dto';
import { cx } from '@pharmacy/ui';
import { getTranslator } from '@/shared/i18n';

const CAPABILITIES = [
  'pos',
  'batches',
  'purchasing',
  'transfers',
  'counts',
  'reports',
  'roles',
  'import',
] as const;

function CapabilityList({
  labels,
  label,
  copy,
}: {
  labels: readonly string[];
  /** Accessible name of the list; the copy has none, it is hidden. */
  label?: string;
  copy?: boolean;
}) {
  return (
    <ul
      aria-label={label}
      aria-hidden={copy || undefined}
      className={cx(
        // the trailing gap (pr) equals the inner one: the two halves of the track are equal, the loop is seamless
        'flex shrink-0 items-center gap-8 pr-8 motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:justify-center',
        'motion-reduce:gap-y-4 motion-reduce:pr-0',
        copy && 'motion-reduce:hidden',
      )}
    >
      {labels.map((text, index) => (
        <li key={index} className="flex min-w-0 items-center gap-8">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-accent-site"
          />
          {/* one line on the moving track; the still list (reduce) may break a long label on a phone */}
          <span className="text-3xl font-bold tracking-tight whitespace-nowrap motion-reduce:whitespace-normal md:text-section">
            {text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CapabilityMarquee({ locale }: { locale: UiLocale }) {
  const t = getTranslator(locale);
  const labels = CAPABILITIES.map((key) => t(`home.marquee.items.${key}`));
  return (
    // clip, not a scroll container: the moving track never widens the page (375 px)
    <div className="overflow-x-clip border-y border-site-line py-8 motion-safe:mask-x-from-90%">
      <div className="site-marquee flex w-max motion-reduce:mx-auto motion-reduce:w-full motion-reduce:max-w-(--ph-size-dialog-xl) motion-reduce:px-4">
        <CapabilityList labels={labels} label={t('home.marquee.label')} />
        <CapabilityList labels={labels} copy />
      </div>
    </div>
  );
}
