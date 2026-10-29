/*
 * Typed links to the admin screens (ADR-0015, ось 1): static routes, ids and filters in the query.
 * Screens that are not built yet keep their final paths so navigation does not change later.
 */
export const routes = {
  dashboard: () => '/',
  login: () => '/login',
  activate: () => '/activate',
  statistics: () => '/statistics',
  companies: () => '/companies',
  companyCreate: () => '/companies/new',
  /** «Новая компания» prefilled from a connection request of the site. */
  companyCreateFromRequest: (requestId: string) =>
    `/companies/new?request=${encodeURIComponent(requestId)}`,
  company: (id: string) => `/companies/view?id=${encodeURIComponent(id)}`,
  store: (id: string) => `/stores/view?id=${encodeURIComponent(id)}`,
  invoices: () => '/billing',
  invoicePrint: (id: string) => `/billing/invoice?id=${encodeURIComponent(id)}`,
  services: () => '/billing/services',
  licenses: () => '/offline/licenses',
  versions: () => '/offline/versions',
  notifications: () => '/notifications',
  auditLog: () => '/audit-log',
  /** The operators' audit log narrowed to one company. */
  companyAuditLog: (tenantId: string) =>
    `/audit-log?tenantId=${encodeURIComponent(tenantId)}`,
  settings: () => '/settings',
  profile: () => '/profile',
  // «Сайт» block (ADR-0023): ids in the query; an article without `id` is a new one
  siteRequests: () => '/site/requests',
  siteRequest: (id: string) =>
    `/site/requests/view?id=${encodeURIComponent(id)}`,
  siteArticles: () => '/site/articles',
  siteArticle: (id?: string) =>
    id === undefined
      ? '/site/articles/edit'
      : `/site/articles/edit?id=${encodeURIComponent(id)}`,
  siteDocuments: () => '/site/documents',
  siteMedia: () => '/site/media',
  siteSettings: () => '/site/settings',
} as const;

export type RouteName = keyof typeof routes;

/** Routes without parameters (navigation menu, redirects). */
export type StaticRouteName = {
  [K in RouteName]: Parameters<(typeof routes)[K]>['length'] extends 0
    ? K
    : never;
}[RouteName];
