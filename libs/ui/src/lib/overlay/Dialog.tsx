'use client';

/*
 * Dialog — native <dialog> + showModal() (ADR-0007): top layer, inert page, focus trap and Esc
 * come from the browser (ARIA APG "Dialog (Modal)").
 * - labelled by its title, described by the optional description;
 * - Esc and a click on the backdrop call onClose; the parent owns `open`;
 * - focus returns to the element that was focused before opening — also when the dialog is
 *   unmounted while open (`{shown && <Dialog open />}`), which fires no `close`;
 * - a dialog inside another (a confirmation) keeps its Esc and `close` to itself: React passes
 *   them up to the parent dialog, which would close too;
 * - below the tablet breakpoint (a phone) it fills the screen whatever its size: the header and the
 *   footer stay, the body scrolls (ADR-0007, amendment 2026-11-10).
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

  useEffect(() => {
    const dialog = ref.current;
    const focusBack = returnFocus;
    return () => {
      if (dialog?.open) focusBack.current?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Esc: keep React as the source of truth for `open`
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
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
        // phone (ADR-0007, amendment 2026-11-10): the whole screen; only the body scrolls. No `display` on the
        // <dialog> itself: an author display would show a closed dialog.
        'max-tablet:m-0 max-tablet:h-dvh max-tablet:max-h-none max-tablet:w-full max-tablet:max-w-none',
        'max-tablet:overflow-hidden max-tablet:rounded-none',
      )}
    >
      {open && (
        <div className="flex flex-col gap-5 p-(--ph-dialog-padding) max-tablet:h-full max-tablet:min-h-0">
          <header className="flex shrink-0 items-start gap-3">
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
          {children && (
            // phone: the body scrolls between the header and the footer; its children keep their height (a table
            // region would shrink into a scroll of its own); -m-1 p-1 keeps focus rings unclipped
            <div className="flex flex-col gap-4 max-tablet:-m-1 max-tablet:min-h-0 max-tablet:flex-1 max-tablet:overflow-y-auto max-tablet:p-1 max-tablet:*:shrink-0">
              {children}
            </div>
          )}
          {footer && (
            <footer className="flex shrink-0 flex-wrap justify-end gap-2 max-tablet:mt-auto">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
