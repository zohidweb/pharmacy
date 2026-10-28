import { useEffect, useRef } from 'react';

/**
 * The ref of the element that shows an error of a mutation: when a new error object arrives the element is
 * scrolled into view (the page may be scrolled to the text above the buttons that caused it).
 */
export function useScrollIntoViewOnError(error: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);
  return ref;
}
