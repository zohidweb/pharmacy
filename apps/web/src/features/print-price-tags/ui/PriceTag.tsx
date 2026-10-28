import { formatMoney } from '@pharmacy/shared-util';
import type { LabelSize } from '@pharmacy/ui';
import { memo, useMemo } from 'react';
import { tagBarcode } from '@/shared/lib/barcode';
import { BarcodeSvg } from '@/shared/ui';
import type { PriceTagData } from '../model/tag';

/*
 * The widest bars a label takes, in modules: the inner width (label − 2 × --ph-tag-padding) over --ph-tag-module, less
 * the quiet zones of BarcodeSvg (2 × 10). 58 × 40: 54 mm / 0.25 mm − 20 = 196; 40 × 30: 36 mm / 0.25 mm − 20 = 124.
 * Recalculate with the print tokens of @pharmacy/ui (tokens/print.css) when the module or the padding is calibrated.
 */
const MAX_BAR_MODULES: Record<LabelSize, number> = {
  '58x40': 196,
  '40x30': 124,
};

/**
 * A price tag of the shelf (UI mockup «Печать ценника», plan 2026-10-28-price-tags-qr, T3): the name, the details, the
 * barcode — or its code as text when it has no symbology — and the price. The same box on screen and on the label; the
 * copies of a print reuse the encoded barcode.
 */
export const PriceTag = memo(function PriceTag({
  tag,
  size,
}: {
  tag: PriceTagData;
  size: LabelSize;
}) {
  const barcode = useMemo(
    () => (tag.barcode ? tagBarcode(tag.barcode, MAX_BAR_MODULES[size]) : null),
    [tag.barcode, size],
  );
  return (
    <div className="ph-label" data-label-size={size}>
      <div className="ph-label-name">{tag.name}</div>
      {tag.details && <div className="ph-label-details">{tag.details}</div>}
      <div className="ph-label-bottom">
        {barcode ? (
          <BarcodeSvg barcode={barcode} />
        ) : (
          tag.barcode && <span className="ph-label-code">{tag.barcode}</span>
        )}
        <span className="ph-label-price">{formatMoney(tag.priceMinor)}</span>
      </div>
    </div>
  );
});
