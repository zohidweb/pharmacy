import { cx } from '@pharmacy/ui';
import type { CSSProperties } from 'react';
import type { LinearBarcode } from '../lib/barcode';

// the quiet zone on each side, in modules
const QUIET = 10;

export interface BarcodeSvgProps {
  barcode: LinearBarcode;
  /** Layout only. */
  className?: string;
}

/**
 * Bars of a linear barcode with its text under them (ADR-0022). The width is modules × `--ph-tag-module` — whole
 * printer dots for crisp bars — and the height of the bars `--ph-tag-bar-height` (print tokens of `@pharmacy/ui`).
 */
export function BarcodeSvg({ barcode, className }: BarcodeSvgProps) {
  const width = barcode.modules.length + 2 * QUIET;
  // one rect per run of bars
  const runs: [number, number][] = [];
  barcode.modules.forEach((bar, i) => {
    if (!bar) return;
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1] === i) last[1] += 1;
    else runs.push([i, 1]);
  });
  return (
    <span
      className={cx('ph-barcode', className)}
      style={{ '--ph-barcode-modules': width } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${width} 1`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        aria-hidden="true"
        className="ph-barcode-bars"
      >
        {runs.map(([x, length]) => (
          <rect key={x} x={x + QUIET} y={0} width={length} height={1} />
        ))}
      </svg>
      <span className="ph-barcode-text">{barcode.text}</span>
    </span>
  );
}
