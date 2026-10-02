/*
 * Typed links to the client-product screens (ADR-0015, ось 1): static routes, ids and filters in the
 * query. Screens of the next stages keep their final paths so navigation does not change later.
 */
export const routes = {
  dashboard: () => '/',
  login: () => '/login',
  profile: () => '/profile',

  pos: () => '/pos',
  shift: () => '/shift',
  returns: () => '/returns',

  stock: () => '/stock',
  goodsReceipts: () => '/goods-receipts',
  transfers: () => '/transfers',
  writeOffs: () => '/write-offs',
  supplierReturns: () => '/supplier-returns',
  stockCounts: () => '/stock-counts',

  orders: () => '/orders',
  suppliers: () => '/suppliers',

  catalog: () => '/catalog',
  product: (id: string) => `/catalog/view?id=${encodeURIComponent(id)}`,
  pricing: () => '/pricing',

  reports: () => '/reports',
  auditLog: () => '/audit-log',

  stores: () => '/stores',
  employees: () => '/employees',

  settings: () => '/settings',
  offline: () => '/offline',
} as const;

export type RouteName = keyof typeof routes;

/** Routes without parameters (navigation menu, redirects). */
export type StaticRouteName = {
  [K in RouteName]: Parameters<(typeof routes)[K]>['length'] extends 0
    ? K
    : never;
}[RouteName];
