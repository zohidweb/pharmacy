import type { Permission } from '@pharmacy/shared-domain';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import type { IconName } from '@pharmacy/ui';
import { can } from '@/entities/session';
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

/** Screens that have a menu item (sign-in and profile live elsewhere). */
export type NavRoute = Exclude<StaticRouteName, 'login' | 'profile'>;

export interface NavItem {
  route: NavRoute;
  icon: IconName;
  /** Permission that opens the screen (ADR-0018); the item is hidden without it. */
  permission: Permission;
  /** False for screens of the next stages: shown, but not a link yet. */
  ready: boolean;
}

export interface NavSection {
  key: NavSectionKey;
  items: NavItem[];
}

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
      },
      {
        route: 'goodsReceipts',
        icon: 'inbox',
        permission: 'inventory:view',
        ready: true,
      },
      {
        route: 'transfers',
        icon: 'arrow-left-right',
        permission: 'inventory:view',
        ready: true,
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
        ready: false,
      },
      {
        route: 'auditLog',
        icon: 'scroll-text',
        permission: 'audit:view',
        ready: false,
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
        ready: false,
      },
      {
        route: 'employees',
        icon: 'users',
        permission: 'employees:view',
        ready: false,
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
        ready: false,
      },
      {
        route: 'offline',
        icon: 'refresh-cw',
        permission: 'sync:view',
        ready: false,
      },
    ],
  },
];

/** Sections and items the session may open; empty sections are dropped. */
export function visibleNavigation(
  session: EmployeeSession | null | undefined,
): NavSection[] {
  return navigation
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => can(session, item.permission)),
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
