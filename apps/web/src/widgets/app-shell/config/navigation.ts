import type { Permission } from '@pharmacy/shared-domain';
import type { EmployeeSession, NavCounters } from '@pharmacy/shared-dto';
import type { IconName } from '@pharmacy/ui';
import { can } from '@/entities/session';
import { isApiRouteAvailable, type ApiRouteKey } from '@/shared/api';
import { routes, type StaticRouteName } from '@/shared/config';

export type NavSectionKey =
  | 'home'
  | 'pos'
  | 'stock'
  | 'purchasing'
  | 'catalog'
  | 'reporting'
  | 'owner'
  | 'settings';

/** Screens that have a menu item (sign-in and profile live elsewhere; a tab is not a screen). */
export type NavRoute = Exclude<
  StaticRouteName,
  'login' | 'activate' | 'profile' | 'storesBilling'
>;

export interface NavItem {
  route: NavRoute;
  icon: IconName;
  /** Permission that opens the screen (ADR-0018); the item is hidden without it. */
  permission: Permission;
  /**
   * The item is also hidden unless the session holds one of these: a screen the role may read but has
   * nothing to do on (the menu only — the server still answers the screen to `permission`).
   */
  anyOf?: readonly Permission[];
  /** False for screens of the next stages: shown, but not a link yet. */
  ready: boolean;
  /** The route the screen loads; the item is hidden in a build where it does not answer. */
  api?: ApiRouteKey;
  /**
   * Number of waiting work next to the item (spec 2026-10-15-nav-counters, E10): a positive number
   * turns the item into a link to the screen filtered by that work at the working store.
   */
  counter?: {
    key: keyof NavCounters;
    tone: 'primary' | 'danger';
    href: (storeId: string) => string;
  };
}

export interface NavSection {
  key: NavSectionKey;
  items: NavItem[];
}

/**
 * Goods receipts, opening balances and supplier returns: for those who post stock documents
 * (manager, owner) or reconcile them (accountant), not for a cashier who may only read them
 * (QA 2026-11-11).
 */
const STOCK_DOCUMENTS: readonly Permission[] = [
  'inventory:post',
  'inventory:export',
];

/** Sidebar of the client product (UI mockups, groups in this order). */
export const navigation: NavSection[] = [
  {
    key: 'home',
    items: [
      {
        route: 'dashboard',
        icon: 'layout-dashboard',
        permission: 'reports:view',
        ready: true,
      },
    ],
  },
  {
    key: 'pos',
    items: [
      {
        route: 'pos',
        icon: 'shopping-cart',
        permission: 'pos:view',
        ready: true,
      },
      {
        route: 'shift',
        icon: 'clock',
        permission: 'shifts:view',
        ready: true,
      },
      {
        route: 'returns',
        icon: 'undo-2',
        permission: 'returns:view',
        ready: true,
      },
    ],
  },
  {
    key: 'stock',
    items: [
      {
        route: 'stock',
        icon: 'package',
        permission: 'inventory:view',
        ready: true,
        counter: {
          key: 'lowStock',
          tone: 'primary',
          href: (storeId) =>
            `${routes.stock()}?view=reorder&storeId=${encodeURIComponent(storeId)}`,
        },
      },
      {
        route: 'goodsReceipts',
        icon: 'inbox',
        permission: 'inventory:view',
        anyOf: STOCK_DOCUMENTS,
        ready: true,
      },
      {
        route: 'openingBalances',
        icon: 'clipboard-list',
        permission: 'inventory:view',
        anyOf: STOCK_DOCUMENTS,
        ready: true,
      },
      {
        route: 'transfers',
        icon: 'arrow-left-right',
        permission: 'inventory:view',
        ready: true,
        counter: {
          key: 'incomingTransfers',
          tone: 'primary',
          href: () => `${routes.transfers()}?incoming=1`,
        },
      },
      {
        route: 'writeOffs',
        icon: 'trash-2',
        permission: 'inventory:view',
        ready: true,
      },
      {
        route: 'supplierReturns',
        icon: 'undo-2',
        permission: 'inventory:view',
        anyOf: STOCK_DOCUMENTS,
        ready: true,
      },
      {
        route: 'stockCounts',
        icon: 'clipboard-list',
        permission: 'inventory:view',
        ready: true,
      },
    ],
  },
  {
    key: 'purchasing',
    items: [
      {
        route: 'orders',
        icon: 'clipboard-list',
        permission: 'purchasing:view',
        ready: true,
      },
      {
        route: 'suppliers',
        icon: 'truck',
        permission: 'purchasing:view',
        ready: true,
      },
    ],
  },
  {
    key: 'catalog',
    items: [
      {
        route: 'catalog',
        icon: 'pill',
        permission: 'catalog:view',
        ready: true,
      },
      {
        route: 'pricing',
        icon: 'tag',
        permission: 'pricing:view',
        ready: true,
        counter: {
          key: 'priceProblems',
          tone: 'danger',
          href: (storeId) =>
            `${routes.pricing()}?problems=1&storeId=${encodeURIComponent(storeId)}`,
        },
      },
    ],
  },
  {
    key: 'reporting',
    items: [
      {
        route: 'reports',
        icon: 'chart-column',
        permission: 'reports:view',
        ready: true,
      },
      {
        // the shift history of the scope (plan 2026-10-27-shift-history, S7)
        route: 'shiftHistory',
        icon: 'clock',
        permission: 'reports:view',
        ready: true,
      },
      {
        route: 'expenses',
        icon: 'wallet',
        permission: 'expenses:view',
        ready: true,
      },
      {
        route: 'auditLog',
        icon: 'scroll-text',
        permission: 'audit:view',
        ready: true,
      },
    ],
  },
  {
    key: 'owner',
    items: [
      {
        route: 'stores',
        icon: 'store',
        permission: 'stores:view',
        ready: true,
      },
      {
        route: 'employees',
        icon: 'users',
        permission: 'employees:view',
        ready: true,
      },
    ],
  },
  {
    key: 'settings',
    items: [
      {
        route: 'settings',
        icon: 'settings',
        permission: 'settings:view',
        ready: true,
      },
      {
        route: 'offline',
        icon: 'refresh-cw',
        permission: 'sync:view',
        ready: true,
        // offline stores are not in the pilot: apps/api has no owner's sync screen yet
        api: 'sync.stores',
      },
    ],
  },
];

/** Sections and items the session may open in this build; empty sections are dropped. */
export function visibleNavigation(
  session: EmployeeSession | null | undefined,
): NavSection[] {
  return navigation
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          can(session, item.permission) &&
          (!item.anyOf ||
            item.anyOf.some((permission) => can(session, permission))) &&
          (!item.api || isApiRouteAvailable(item.api)),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/** Where to go after sign-in: the first ready screen the session may open, else the profile. */
export function landingRoute(
  session: EmployeeSession | null | undefined,
): string {
  const first = visibleNavigation(session)
    .flatMap((section) => section.items)
    .find((item) => item.ready);
  return first ? routes[first.route]() : routes.profile();
}

/** The nav item whose path is the longest prefix of the current path. */
export function activeRoute(pathname: string): NavRoute | null {
  let best: { route: NavRoute; length: number } | null = null;
  for (const section of navigation) {
    for (const item of section.items) {
      const path = routes[item.route]();
      const matches =
        path === '/'
          ? pathname === '/'
          : pathname === path || pathname.startsWith(`${path}/`);
      if (matches && (!best || path.length > best.length)) {
        best = { route: item.route, length: path.length };
      }
    }
  }
  return best?.route ?? null;
}
