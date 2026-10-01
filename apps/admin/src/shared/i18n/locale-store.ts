'use client';

/*
 * Current UI locale: a tiny external store (useSyncExternalStore), remembered per browser in
 * localStorage — a per-viewer convenience without personal data; reads/writes never throw.
 */
import { useSyncExternalStore } from 'react';
import { defaultLocale, isLocale, type Locale } from './config';

const STORAGE_KEY = 'pharmacy-admin-locale';
const listeners = new Set<() => void>();
let current: Locale | null = null;

function readStored(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

export function getLocale(): Locale {
  if (current === null) current = readStored();
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage unavailable: the choice lasts until reload
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server render and first paint use the default locale; the stored one applies after hydration. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => defaultLocale);
}
