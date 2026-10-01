'use client';

/*
 * Toast — short confirmation after an action ("Настройки сохранены").
 * aria-live="polite" region that never takes focus (WCAG 4.1.3); rendered as popover="manual"
 * so it stays in the top layer above an open <dialog> (ADR-0007). Auto-dismiss after
 * TOAST_DURATION_MS; important information must not live only in a toast.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '../icon/Icon';
import type { IconName } from '../icon/icons';

export const TOAST_DURATION_MS = 3200;

export type ToastTone = 'success' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, options?: { tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneIcon: Record<ToastTone, IconName> = {
  success: 'circle-check',
  info: 'info',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const regionRef = useRef<HTMLDivElement>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    timers.current.delete(id);
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, options) => {
      const id = nextId.current++;
      setItems((current) => [
        ...current,
        { id, message, tone: options?.tone ?? 'success' },
      ]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );
    },
    [dismiss],
  );

  const regionOpen = useRef(false);
  useEffect(() => {
    const region = regionRef.current;
    if (!region?.showPopover) return;
    const shouldOpen = items.length > 0;
    if (shouldOpen === regionOpen.current) return;
    if (shouldOpen) region.showPopover();
    else region.hidePopover();
    regionOpen.current = shouldOpen;
  }, [items.length]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={regionRef}
        popover="manual"
        role="status"
        aria-live="polite"
        className="inset-x-0 top-auto bottom-6 m-auto flex w-max max-w-(--ph-dialog-max-inline) flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-full bg-inverse px-5 py-3 text-sm text-on-inverse shadow-xl"
          >
            <span className="text-on-inverse-success">
              <Icon name={toneIcon[item.tone]} size="sm" />
            </span>
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return api;
}
