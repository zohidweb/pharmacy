'use client';

/*
 * Drawer — a side panel at the inline start: native <dialog> + showModal() (ADR-0007, п. 4; amendment
 * 2026-11-10 — the menu of the phone layout). Top layer, inert page, focus trap and Esc come from the
 * browser (ARIA APG "Dialog (Modal)"):
 * - named by `label` (aria-label); the trigger points at it with aria-controls={id};
 * - Esc, a click on the backdrop and the close button call onClose; the parent owns `open`;
 * - focus returns to the element that was focused before opening — also when the drawer is
 *   unmounted while open, which fires no `close`;
 * - the content is rendered only while open; no `display` on the <dialog> itself (an author display
 *   would show a closed dialog).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../button/IconButton';

export interface DrawerProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close button; must set `open` to false. */
  onClose: () => void;
  /** Id of the <dialog>, for aria-controls of the trigger. */
  id?: string;
  /** Localized name of the panel, e.g. "Основная навигация". */
  label: string;
  /** Localized name of the close button, e.g. "Закрыть меню". */
  closeLabel: string;
  children: ReactNode;
}

export function Drawer({
  open,
  onClose,
  id,
  label,
  closeLabel,
  children,
}: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

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
      id={id}
      aria-label={label}
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
      className="inset-y-0 start-0 m-0 h-dvh max-h-none w-sidebar max-w-(--ph-drawer-max-inline) border-e border-border bg-surface p-0 text-fg shadow-(--ph-dialog-shadow) backdrop:bg-overlay"
    >
      {open && (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 justify-end px-3 pt-3">
            <IconButton
              icon="x"
              label={closeLabel}
              variant="subtle"
              iconSize="sm"
              onClick={onClose}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
