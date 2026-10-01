'use client';

/*
 * Tabs — ARIA APG "Tabs with Automatic Activation" (ADR-0007).
 * - tablist / tab / tabpanel roles, aria-selected, aria-controls ↔ aria-labelledby;
 * - roving tabindex: only the selected tab is in the tab order;
 * - ArrowLeft/ArrowRight move and activate (wrapping), Home/End jump to the ends;
 * - Tab from the tablist moves into the active panel (tabIndex=0 on the panel).
 * Only the active panel is rendered.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../cx';
import { CountBadge } from '../display/CountBadge';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Optional counter next to the label. */
  count?: number;
  panel: ReactNode;
}

export interface TabsProps<T extends string> {
  /** Localized name of the tablist, e.g. "Разделы компании". */
  label: string;
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Layout only. */
  className?: string;
}

export function Tabs<T extends string>({
  label,
  items,
  value,
  onValueChange,
  className,
}: TabsProps<T>) {
  const baseId = useId();
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (item: T) => `${baseId}-tab-${item}`;
  const panelId = (item: T) => `${baseId}-panel-${item}`;
  const active = items.find((item) => item.value === value) ?? items[0];

  const select = (index: number) => {
    const item = items[(index + items.length) % items.length];
    onValueChange(item.value);
    tabRefs.current.get(item.value)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.value === active?.value);
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      select(moves[event.key]);
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((item) => {
          const selected = item.value === active?.value;
          return (
            <button
              key={item.value}
              ref={(element) => {
                if (element) tabRefs.current.set(item.value, element);
                else tabRefs.current.delete(item.value);
              }}
              type="button"
              role="tab"
              id={tabId(item.value)}
              aria-selected={selected}
              aria-controls={panelId(item.value)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(item.value)}
              className={cx(
                '-mb-px inline-flex min-h-(--ph-button-height) items-center gap-2 border-b-2 px-4',
                'text-sm whitespace-nowrap transition-colors',
                selected
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <CountBadge count={item.count} tone="neutral" />
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={panelId(active.value)}
          aria-labelledby={tabId(active.value)}
          tabIndex={0}
          className="pt-5"
        >
          {active.panel}
        </div>
      )}
    </div>
  );
}
