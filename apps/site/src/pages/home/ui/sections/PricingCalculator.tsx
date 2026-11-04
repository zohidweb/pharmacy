'use client';

/*
 * The stores calculator of the «Тарифы» panel (spec 2026-11-04-public-site-home-polish, H4): a range input from 1 to 30
 * stores and the monthly sum for that many stores, with and without VAT. The component owns only the discrete slider
 * value. The texts arrive finished: the server component builds the two sentences for every count in the range (money
 * formatting, ICU plural of the language, VAT), so the client loads neither the dictionary nor the ICU parser, and a
 * function never crosses the server/client boundary. Rendered on the server with the starting count, so without
 * JavaScript the sums for 3 stores are in the HTML; the slider then simply does not change them.
 *
 * The block is `surface-sunken` (emerald-900); from 1024 px it fills the right column of the panel (spec H9.3), below
 * it keeps a reading width. The slider (`site-range`, site-theme.css) has a mint-300 track (6.3:1 to the block) and a
 * mint-400 thumb (5.9:1). The number beside it is decorative (`aria-hidden`): the range input announces its own value.
 *
 * Spec H8.5 (amendment 2026-11-04): the sums do not jump, they count up to the new value in 0.4 s. The server already
 * holds the finished sentence of every count, so the count runs through them: a `requestAnimationFrame` loop moves a
 * fractional index along `lines` (ease-out) and writes the nearest line into the two visible spans and the number
 * beside the slider (so the sentence and the number stay in step) through refs: no React render per frame, no animation
 * engine in the bundle, no money formatting on the client. The visible sums are `aria-hidden`: a screen reader hears
 * only the final text, from a separate polite live region that follows the slider with a delay of the same 0.4 s (a
 * drag through twenty counts is announced once). With reduce the sums change at once.
 * The spans hold the text of the starting count in the HTML, so without JavaScript the sums for 3 stores are there.
 */
import { useEffect, useId, useRef, useState } from 'react';

/** Time the sums take to settle on a new count of stores, ms (spec H8.5). */
const TWEEN_MS = 400;

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
  const startLine = lines[initial - min];
  const total = useRef<HTMLSpanElement>(null);
  const withVat = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  // the index of `lines` the visible sums stand at, fractional while they count
  const shown = useRef(initial - min);
  // the count the live region announces: the slider's, once it has been still for the length of the tween
  const [announced, setAnnounced] = useState(initial);

  useEffect(() => {
    const target = stores - min;
    const from = shown.current;
    const paint = (index: number) => {
      const line = lines[Math.round(index)];
      if (total.current) total.current.textContent = line.total;
      if (withVat.current) withVat.current.textContent = line.withVat;
      if (count.current)
        count.current.textContent = String(Math.round(index) + min);
    };
    let frame = 0;
    if (
      from === target ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      shown.current = target;
      paint(target);
    } else {
      const start = performance.now();
      const step = (now: number) => {
        const done = Math.min(1, (now - start) / TWEEN_MS);
        shown.current = from + (target - from) * (1 - (1 - done) ** 3);
        paint(shown.current);
        if (done < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
    const announce = setTimeout(() => setAnnounced(stores), TWEEN_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(announce);
    };
  }, [stores, min, lines]);

  const announcedLine = lines[announced - min];
  return (
    <div className="flex w-full max-w-(--ph-size-dialog-md) flex-col gap-4 rounded-site-card bg-surface-sunken p-6 md:max-w-none md:p-8">
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
          ref={count}
          aria-hidden="true"
          className="w-16 shrink-0 text-end text-section tabular-nums"
        >
          {initial}
        </span>
      </div>
      {/* the sums that count: the text of the starting count stays in the HTML, the effect repaints it */}
      <p aria-hidden="true" className="flex flex-col gap-1">
        <span ref={total} className="text-xl font-bold tabular-nums">
          {startLine.total}
        </span>
        <span ref={withVat} className="text-lead tabular-nums">
          {startLine.withVat}
        </span>
      </p>
      {/* what a screen reader hears: the final sums only */}
      <p aria-live="polite" className="sr-only">
        <span className="block">{announcedLine.total}</span>
        <span className="block">{announcedLine.withVat}</span>
      </p>
      <p className="text-sm">{labels.note}</p>
    </div>
  );
}
