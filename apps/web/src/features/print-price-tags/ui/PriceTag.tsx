import { formatMoney } from '@pharmacy/shared-util';
import type { LabelSize } from '@pharmacy/ui';
import { tagBarcode } from '@/shared/lib/barcode';
import { BarcodeSvg } from '@/shared/ui';
import type { PriceTagData } from '../model/tag';

// the longest Code 128 that fits the inner width of the label at a 0.25 mm module (ADR-0022)
const MAX_CODE128: Record<LabelSize, number> = { '58x40': 14, '40x30': 8 };

/**
 * A price tag of the shelf (UI mockup «Печать ценника», plan 2026-10-28-price-tags-qr, T3): the name, the details, the
 * barcode — or its code as text when it has no symbology — and the price. The same box on screen and on the label.
 */
export function PriceTag({
  tag,
  size,
}: {
  tag: PriceTagData;
  size: LabelSize;
}) {
  const barcode = tag.barcode
    ? tagBarcode(tag.barcode, MAX_CODE128[size])
    : null;
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
}
