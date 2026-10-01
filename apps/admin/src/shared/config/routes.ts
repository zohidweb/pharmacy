/*
 * Typed links to the admin screens (ADR-0015, ось 1): static routes, ids and filters in the query.
 * Screens that are not built yet keep their final paths so navigation does not change later.
 */
export const routes = {
  dashboard: () => '/',
  login: () => '/login',
  statistics: () => '/statistics',
  companies: () => '/companies',
  companyCreate: () => '/companies/new',
  company: (id: string) => `/companies/view?id=${encodeURIComponent(id)}`,
  store: (id: string) => `/stores/view?id=${encodeURIComponent(id)}`,
  invoices: () => '/billing',
  services: () => '/billing/services',
  licenses: () => '/offline/licenses',
  versions: () => '/offline/versions',
  notifications: () => '/notifications',
  auditLog: () => '/audit-log',
  settings: () => '/settings',
  profile: () => '/profile',
} as const;

export type RouteName = keyof typeof routes;

/** Routes without parameters (navigation menu, redirects). */
export type StaticRouteName = {
  [K in RouteName]: Parameters<(typeof routes)[K]>['length'] extends 0
    ? K
    : never;
}[RouteName];
