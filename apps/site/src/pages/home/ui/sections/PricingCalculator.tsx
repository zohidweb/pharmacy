'use client';

/*
 * The stores calculator of the «Тарифы» panel (spec 2026-11-04-public-site-home-polish, H4): a range input from 1 to 30
 * stores and the monthly sum for that many stores, with and without VAT. The component owns only the discrete slider
 * value. The texts arrive finished: the server component builds the two sentences for every count in the range (money
 * formatting, ICU plural of the language, VAT), so the client loads neither the dictionary nor the ICU parser, and a
 * function never crosses the server/client boundary. Rendered on the server with the starting count, so without
 * JavaScript the sums for 3 stores are in the HTML; the slider then simply does not change them.
 *
 * The block is `surface-sunken` (emerald-900). The slider (`site-range`, site-theme.css) has a mint-300 track (6.3:1 to
 * the block) and a mint-400 thumb (5.9:1). The number beside it is decorative (`aria-hidden`): the range input
 * announces its own value, and the sums sit in a polite live region.
 */
import { useId, useState } from 'react';

export interface PricingCalculatorLine {
  /** «{amount} в месяц за N аптек», already formatted. */
  total: string;
  /** «С НДС {amount}», already formatted. */
  withVat: string;
}

export interface PricingCalculatorProps {
  min: number;
  max: number;
  initial: number;
  labels: { label: string; note: string };
  /** One entry per count of stores, from `min` to `max` (entry 0 is `min`). */
  lines: readonly PricingCalculatorLine[];
}

export function PricingCalculator({
  min,
  max,
  initial,
  labels,
  lines,
}: PricingCalculatorProps) {
  const inputId = useId();
  const [stores, setStores] = useState(initial);
  const line = lines[stores - min];
  return (
    <div className="flex w-full max-w-(--ph-size-dialog-md) flex-col gap-4 rounded-site-card bg-surface-sunken p-6">
      <label htmlFor={inputId} className="font-semibold">
        {labels.label}
      </label>
      <div className="flex items-center gap-4">
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={1}
          value={stores}
          onChange={(event) => setStores(event.currentTarget.valueAsNumber)}
          className="min-h-touch min-w-0 flex-1 cursor-pointer site-range"
        />
        <span
          aria-hidden="true"
          className="w-16 shrink-0 text-end text-section tabular-nums"
        >
          {stores}
        </span>
      </div>
      <p aria-live="polite" className="flex flex-col gap-1">
        <span className="text-xl font-bold">{line.total}</span>
        <span className="text-lead">{line.withVat}</span>
      </p>
      <p className="text-sm">{labels.note}</p>
    </div>
  );
}
