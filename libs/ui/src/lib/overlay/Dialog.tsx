'use client';

/*
 * Dialog — native <dialog> + showModal() (ADR-0007): top layer, inert page, focus trap and Esc
 * come from the browser (ARIA APG "Dialog (Modal)").
 * - labelled by its title, described by the optional description;
 * - Esc and a click on the backdrop call onClose; the parent owns `open`;
 * - focus returns to the element that was focused before opening.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../cx';
import { IconButton } from '../button/IconButton';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';

/** xl — document editors with wide line tables (stock documents). */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<DialogSize, string> = {
  sm: 'w-(--ph-size-dialog-sm)',
  md: 'w-(--ph-size-dialog-md)',
  lg: 'w-(--ph-size-dialog-lg)',
  xl: 'w-(--ph-size-dialog-xl)',
};

export type DialogTone =
  'default' | 'warning' | 'danger' | 'attention' | 'info';

const toneIconClass: Record<Exclude<DialogTone, 'default'>, string> = {
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  attention: 'bg-attention-subtle text-attention',
  info: 'bg-info-subtle text-info',
};

export interface DialogProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close button; must set `open` to false. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Localized name of the close button, e.g. "Закрыть". */
  closeLabel: string;
  /** Icon badge next to the title for confirmations. */
  icon?: IconName;
  tone?: DialogTone;
  size?: DialogSize;
  children?: ReactNode;
  /** Action buttons, end-aligned (dismiss first, confirm last). */
  footer?: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  icon,
  tone = 'default',
  size = 'sm',
  children,
  footer,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Esc: keep React as the source of truth for `open`
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
        returnFocus.current?.focus();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cx(
        'm-auto max-h-(--ph-dialog-max-block) max-w-(--ph-dialog-max-inline) overflow-y-auto',
        'rounded-(--ph-dialog-radius) border-0 bg-surface p-0 text-fg shadow-(--ph-dialog-shadow)',
        'backdrop:bg-overlay',
        sizeClass[size],
      )}
    >
      {open && (
        <div className="flex flex-col gap-5 p-6">
          <header className="flex items-start gap-3">
            {icon && tone !== 'default' && (
              <span
                className={cx(
                  'grid size-10 shrink-0 place-items-center rounded-full',
                  toneIconClass[tone],
                )}
              >
                <Icon name={icon} size="md" />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id={titleId} className="text-lg font-bold text-fg">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="text-sm text-fg-muted">
                  {description}
                </p>
              )}
            </div>
            <IconButton
              icon="x"
              label={closeLabel}
              variant="subtle"
              iconSize="sm"
              onClick={onClose}
              className="-me-2 -mt-2"
            />
          </header>
          {children && <div className="flex flex-col gap-4">{children}</div>}
          {footer && (
            <footer className="flex flex-wrap justify-end gap-2">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
