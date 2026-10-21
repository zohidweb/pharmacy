/*
 * Typed links to the client-product screens (ADR-0015, ось 1): static routes, ids and filters in the
 * query. Screens of the next stages keep their final paths so navigation does not change later.
 */
export const routes = {
  dashboard: () => '/',
  login: () => '/login',
  activate: () => '/activate',
  profile: () => '/profile',

  pos: () => '/pos',
  shift: () => '/shift',
  returns: () => '/returns',

  stock: () => '/stock',
  goodsReceipts: () => '/goods-receipts',
  openingBalances: () => '/opening-balances',
  transfers: () => '/transfers',
  writeOffs: () => '/write-offs',
  supplierReturns: () => '/supplier-returns',
  stockCounts: () => '/stock-counts',

  orders: () => '/orders',
  suppliers: () => '/suppliers',
  /** Loading data from a file (spec 2026-10-20-data-import): `catalog`, `opening-balances`, `suppliers`. */
  dataImport: (kind: string) => `/imports?kind=${encodeURIComponent(kind)}`,

  catalog: () => '/catalog',
  product: (id: string) => `/catalog/view?id=${encodeURIComponent(id)}`,
  pricing: () => '/pricing',

  reports: () => '/reports',
  expenses: () => '/expenses',
  auditLog: () => '/audit-log',

  stores: () => '/stores',
  storesBilling: () => '/stores?tab=billing',
  invoicePrint: (id: string) => `/stores/invoice?id=${encodeURIComponent(id)}`,
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
