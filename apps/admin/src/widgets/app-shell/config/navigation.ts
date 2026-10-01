import type { IconName } from '@pharmacy/ui';
import { routes, type RouteName } from '@/shared/config';

type NavLabelKey =
  | 'dashboard'
  | 'statistics'
  | 'companies'
  | 'createCompany'
  | 'invoices'
  | 'services'
  | 'licenses'
  | 'versions'
  | 'notifications'
  | 'auditLog'
  | 'settings';

export interface NavItem {
  route: RouteName;
  label: NavLabelKey;
  icon: IconName;
}

export interface NavSection {
  title: 'overview' | 'clients' | 'billing' | 'offline' | 'system';
  items: NavItem[];
}

/** Sidebar of the platform-operator admin (UI mockups, sections in this order). */
export const navigation: NavSection[] = [
  {
    title: 'overview',
    items: [
      { route: 'dashboard', label: 'dashboard', icon: 'layout-dashboard' },
      { route: 'statistics', label: 'statistics', icon: 'chart-column' },
    ],
  },
  {
    title: 'clients',
    items: [
      { route: 'companies', label: 'companies', icon: 'building-2' },
      { route: 'companyCreate', label: 'createCompany', icon: 'user-plus' },
    ],
  },
  {
    title: 'billing',
    items: [
      { route: 'invoices', label: 'invoices', icon: 'receipt' },
      { route: 'services', label: 'services', icon: 'sparkles' },
    ],
  },
  {
    title: 'offline',
    items: [
      { route: 'licenses', label: 'licenses', icon: 'key-round' },
      { route: 'versions', label: 'versions', icon: 'package' },
    ],
  },
  {
    title: 'system',
    items: [
      { route: 'notifications', label: 'notifications', icon: 'bell' },
      { route: 'auditLog', label: 'auditLog', icon: 'scroll-text' },
      { route: 'settings', label: 'settings', icon: 'settings' },
    ],
  },
];

/** The nav item whose path is the longest prefix of the current path (/companies/new → create). */
export function activeRoute(pathname: string): RouteName | null {
  let best: { route: RouteName; length: number } | null = null;
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
