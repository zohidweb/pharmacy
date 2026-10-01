'use client';

/*
 * Popover — Popover API (`popover="auto"`) + CSS anchor positioning (ADR-0007).
 * The browser provides top layer, light dismiss (click outside) and Esc; focus returns to the
 * trigger on Esc. The trigger gets aria-expanded synced from the `toggle` event and
 * aria-controls pointing at the panel. For non-modal panels (notifications, quick filters);
 * menus with arrow-key navigation are a separate component.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cx } from '../cx';

export interface PopoverTriggerProps {
  popoverTarget: string;
  'aria-expanded': boolean;
  'aria-controls': string;
  style: CSSProperties;
}

export interface PopoverProps {
  /** Renders the trigger; spread the given props onto a <button>. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** Localized name of the panel, e.g. "Уведомления". */
  label: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Panel width token (spacing namespace), default dialog-sm. */
  width?: 'sm' | 'md';
}

const widthClass = {
  sm: 'w-(--ph-size-dialog-sm)',
  md: 'w-(--ph-size-dialog-md)',
} as const;

export function Popover({
  trigger,
  label,
  children,
  width = 'sm',
}: PopoverProps) {
  const reactId = useId();
  const panelId = `popover-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const anchorName = `--${panelId}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (event: Event) => {
      setExpanded((event as Event & { newState?: string }).newState === 'open');
    };
    panel.addEventListener('toggle', onToggle);
    return () => panel.removeEventListener('toggle', onToggle);
  }, []);

  const close = () => panelRef.current?.hidePopover();

  return (
    <>
      {trigger({
        popoverTarget: panelId,
        'aria-expanded': expanded,
        'aria-controls': panelId,
        // ignore-design: anchor linkage, not a visual value
        style: { anchorName } as CSSProperties,
      })}
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role="region"
        aria-label={label}
        // ignore-design: anchor linkage, not a visual value
        style={{ positionAnchor: anchorName } as CSSProperties}
        className={cx(
          'ph-popover max-w-(--ph-dialog-max-inline) rounded-lg border border-border bg-surface p-0',
          'text-fg shadow-lg',
          widthClass[width],
        )}
      >
        {typeof children === 'function' ? children(close) : children}
      </div>
    </>
  );
}
