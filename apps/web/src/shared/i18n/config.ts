/*
 * i18n of the client product (ADR-0015, ось 5): use-intl on the client, RU by default, TJ loaded on demand.
 * Keys are English identifiers; the RU dictionary is the source of truth for the key set
 * (typed via AppConfig in ./use-intl.d.ts). Money and dates are formatted by @pharmacy/shared-util.
 *
 * Dictionaries are split into groups so a route loads only what it shows (the POS budget,
 * ADR-0009): `core` (shell, sign-in, errors) is bundled; every other group is a separate chunk a
 * page asks for with <WithMessages groups={…}>.
 */
import core from './messages/ru/core.json';
import type home from './messages/ru/home.json';
import type ownerGroup from './messages/ru/owner.json';
import type pos from './messages/ru/pos.json';
import type purchasing from './messages/ru/purchasing.json';
import type stock from './messages/ru/stock.json';

export type CoreMessages = typeof core;
export type Messages = CoreMessages &
  typeof pos &
  typeof home &
  typeof stock &
  typeof purchasing &
  typeof ownerGroup;

export const messageGroups = [
  'pos',
  'home',
  'stock',
  'purchasing',
  'owner',
] as const;
export type MessageGroup = (typeof messageGroups)[number];

export const locales = ['ru', 'tg'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ru';

export const APP_TIME_ZONE = 'Asia/Dushanbe';

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' && (locales as readonly string[]).includes(value)
  );
}

type Dictionary = Record<string, unknown>;

/** Static import paths: the bundler makes one chunk per group and locale. */
const groupLoaders: Record<
  Locale,
  Record<MessageGroup, () => Promise<{ default: Dictionary }>>
> = {
  ru: {
    pos: () => import('./messages/ru/pos.json'),
    home: () => import('./messages/ru/home.json'),
    stock: () => import('./messages/ru/stock.json'),
    purchasing: () => import('./messages/ru/purchasing.json'),
    owner: () => import('./messages/ru/owner.json'),
  },
  tg: {
    pos: () => import('./messages/tg/pos.json'),
    home: () => import('./messages/tg/home.json'),
    stock: () => import('./messages/tg/stock.json'),
    purchasing: () => import('./messages/tg/purchasing.json'),
    owner: () => import('./messages/tg/owner.json'),
  },
};

/** The core dictionary of a locale (shell, sign-in, errors). */
export async function loadMessages(locale: Locale): Promise<CoreMessages> {
  if (locale === 'ru') return core;
  const tg = await import('./messages/tg/core.json');
  return tg.default;
}

const loadedGroups = new Map<string, Dictionary>();
const groupKey = (locale: Locale, group: MessageGroup) => `${locale}:${group}`;

/** Already loaded groups, merged; null while one of them is still missing. */
export function cachedGroups(
  locale: Locale,
  groups: readonly MessageGroup[],
): Dictionary | null {
  const parts = groups.map((g) => loadedGroups.get(groupKey(locale, g)));
  if (parts.some((part) => part === undefined)) return null;
  return Object.assign({}, ...parts);
}

export async function loadGroups(
  locale: Locale,
  groups: readonly MessageGroup[],
): Promise<Dictionary> {
  await Promise.all(
    groups.map(async (group) => {
      const key = groupKey(locale, group);
      if (loadedGroups.has(key)) return;
      const module = await groupLoaders[locale][group]();
      loadedGroups.set(key, module.default);
    }),
  );
  return cachedGroups(locale, groups) ?? {};
}

/** Tests: put dictionaries into the cache without loading chunks. */
export function seedMessageGroup(
  locale: Locale,
  group: MessageGroup,
  messages: Dictionary,
) {
  loadedGroups.set(groupKey(locale, group), messages);
}

export const defaultMessages: CoreMessages = core;
