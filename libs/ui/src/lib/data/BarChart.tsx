/*
 * BarChart — simple vertical bars on CSS (no chart library, ADR-0007).
 * The bars are decorative (aria-hidden); the same data is exposed as a visually hidden table,
 * so screen readers get exact values (WCAG 1.1.1). Values are already formatted by the caller.
 */
import type { CSSProperties } from 'react';
import { cx } from '../cx';

export interface BarChartItem {
  key: string;
  /** Axis label, e.g. "08.09". */
  label: string;
  value: number;
  /** Formatted value for the accessible table and the bar tooltip, e.g. "12 400,00 с". */
  valueText: string;
}

export interface BarChartProps {
  /** Localized caption, e.g. "Продажи компаний за 14 дней". */
  caption: string;
  /** Header names of the hidden table. */
  columnLabels: { label: string; value: string };
  items: ReadonlyArray<BarChartItem>;
  /** Layout only. */
  className?: string;
}

export function BarChart({
  caption,
  columnLabels,
  items,
  className,
}: BarChartProps) {
  const max = Math.max(0, ...items.map((item) => item.value));

  return (
    <figure className={cx('m-0', className)}>
      <div
        aria-hidden="true"
        className="flex h-(--ph-size-chart-height) items-end gap-2 border-b border-border"
      >
        {items.map((item) => (
          <div
            key={item.key}
            title={`${item.label}: ${item.valueText}`}
            className="h-(--bar-height) min-h-0.5 flex-1 rounded-t-sm bg-accent"
            // ignore-design: data-driven bar height, passed as a CSS variable
            style={
              {
                '--bar-height': `${max > 0 ? (item.value / max) * 100 : 0}%`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div aria-hidden="true" className="mt-2 flex gap-2">
        {items.map((item) => (
          <span
            key={item.key}
            className="flex-1 truncate text-center text-2xs text-fg-subtle tabular-nums"
          >
            {item.label}
          </span>
        ))}
      </div>
      <table className="ph-visually-hidden">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{columnLabels.label}</th>
            <th scope="col">{columnLabels.value}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <td>{item.label}</td>
              <td>{item.valueText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
