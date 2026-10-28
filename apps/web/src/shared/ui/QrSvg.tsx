import { cx } from '@pharmacy/ui';
import { useMemo } from 'react';
import { qrModules } from '@/shared/lib/barcode';

// the quiet zone on each side, in modules (ISO/IEC 18004)
const QUIET = 4;

export interface QrSvgProps {
  text: string;
  /** Accessible name, e.g. «QR-код чека». */
  label: string;
  /** The size comes from CSS (`ph-receipt-qr` and the print tokens of `@pharmacy/ui`). */
  className?: string;
}

/** A QR code as one SVG path of dark modules (ADR-0022). */
export function QrSvg({ text, label, className }: QrSvgProps) {
  const { size, path } = useMemo(() => {
    const modules = qrModules(text);
    const d = modules
      .flatMap((row, y) =>
        row.map((dark, x) =>
          dark ? `M${x + QUIET} ${y + QUIET}h1v1h-1z` : '',
        ),
      )
      .join('');
    return { size: modules.length + 2 * QUIET, path: d };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className={cx('ph-qr', className)}
    >
      <path d={path} />
    </svg>
  );
}
