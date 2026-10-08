/*
 * Map of the REST routes the client product calls (ADR-0015, ось 2б): one place that ties a route key
 * to its method, path and DTO types from @pharmacy/shared-dto. Paths are relative to /api/v1.
 */
import type {
  AuditListResponse,
  AuditQuery,
  CategoryMarkup,
  CloseStoreRequest,
  CloseStoreResponse,
  CreateEmployeeRequest,
  EmployeeCard,
  EmployeeListQuery,
  EmployeeListResponse,
  Export1cPreview,
  Export1cRequest,
  Export1cResult,
  NetworkSettings,
  OfflineQueueResponse,
  OfflineStoreSync,
  OwnerStore,
  ReportKind,
  ReportTable,
  ResetEmployeePasswordRequest,
  ResolveDuplicateRequest,
  Role,
  RoleInput,
  SetArticle1cRequest,
  SetEmployeePinRequest,
  SetEmployeeStatusRequest,
  StoreClosingPreview,
  CreateStoreRequest,
  LegalEntitiesResponse,
  LegalEntity,
  LegalEntityInput,
  UpdateLegalEntityRequest,
  UpdateOwnerStoreRequest,
  StoresOverview,
  SyncRunResult,
  TenantBilling,
  TenantService,
  TenantServiceKey,
  TenantTerminal,
  UpdateEmployeeRequest,
  UpdateMarkupsRequest,
  CatalogDuplicate,
  CatalogListQuery,
  CatalogListResponse,
  CatalogProduct,
  CatalogProductCard,
  CatalogProductInput,
  CatalogReferences,
  Category,
  CategoryInput,
  DeficitLine,
  DiscountRuleDefinition,
  DiscountRuleInput,
  PriceConflict,
  PriceListQuery,
  PriceListResponse,
  StorePrice,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderListQuery,
  PurchaseOrderListResponse,
  ResolvePriceConflictRequest,
  Supplier,
  SupplierCard,
  SupplierInput,
  SupplierListResponse,
  SupplierLedgerEntry,
  SupplierPaymentRequest,
  UpdateCatalogStatusRequest,
  UpdateCategoryStatusRequest,
  UpdatePricesRequest,
  AcceptTransferRequest,
  DiscrepancyResolution,
  DocumentListQuery,
  GoodsReceipt,
  GoodsReceiptInput,
  GoodsReceiptListResponse,
  PurchaseOrderOption,
  RejectionReason,
  SaveStockCountRequest,
  StartStockCountRequest,
  StockCount,
  StockCountListItem,
  StockDocumentKind,
  StockListQuery,
  StockListResponse,
  StockProductOption,
  SupplierOption,
  SupplierReturn,
  SupplierReturnInput,
  SupplierReturnListResponse,
  Transfer,
  TransferInput,
  TransferOverview,
  TransferRequest,
  TransferRequestInput,
  UnpostCheck,
  WriteOff,
  WriteOffInput,
  WriteOffListResponse,
  BoundTerminal,
  CashMovementRequest,
  CatalogSnapshot,
  CloseShiftRequest,
  CreatedReceipt,
  CreatedReturn,
  CreateReceiptRequest,
  CreateReturnRequest,
  DeploymentInfo,
  HeldReceipt,
  HoldReceiptRequest,
  OpenShiftRequest,
  ReturnableReceipt,
  ReturnListResponse,
  ReturnReason,
  SaleSearchItem,
  Shift,
  ZReport,
  ChangePasswordRequest,
  ChangePinRequest,
  DashboardPeriod,
  ActivationRequest,
  EmployeeLoginRequest,
  EmployeeMe,
  EmployeeSession,
  MyTerminal,
  PinLoginRequest,
  ConfirmSessionRequest,
  SelectStoreRequest,
  SyncStatus,
  TenantDashboard,
  TenantNotificationListResponse,
  UpdateEmployeeMeRequest,
} from '@pharmacy/shared-dto';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type QueryValue = string | number | boolean | undefined;

interface RouteDef<Params, Query, Body, Response> {
  method: Method;
  path: (params: Params) => string;
  /** Phantom fields: carry the types only. */
  params?: Params;
  query?: Query;
  body?: Body;
  response?: Response;
}

function route<
  Response,
  Body = undefined,
  Params = undefined,
  Query = undefined,
>(
  method: Method,
  path: (params: Params) => string,
): RouteDef<Params, Query, Body, Response> {
  return { method, path };
}

const id = (params: { id: string }) => encodeURIComponent(params.id);

export const apiRoutes = {
  'sessions.create': route<EmployeeSession, EmployeeLoginRequest>(
    'POST',
    () => '/sessions',
  ),
  'sessions.current': route<EmployeeSession>('GET', () => '/sessions/current'),
  'sessions.selectStore': route<EmployeeSession, SelectStoreRequest>(
    'PUT',
    () => '/sessions/current/store',
  ),
  'sessions.delete': route<void>('DELETE', () => '/sessions/current'),
  'sessions.confirm': route<void, ConfirmSessionRequest>(
    'POST',
    () => '/sessions/current/confirmation',
  ),
  'activations.create': route<void, ActivationRequest>(
    'POST',
    () => '/activations',
  ),

  'terminals.current': route<BoundTerminal>('GET', () => '/terminals/current'),
  'terminals.unbind': route<void, undefined, { id: string }>(
    'DELETE',
    (p) => `/terminals/${id(p)}`,
  ),
  'terminalSessions.create': route<EmployeeSession, PinLoginRequest>(
    'POST',
    () => '/terminal-sessions',
  ),

  'sync.status': route<SyncStatus>('GET', () => '/sync/status'),

  'dashboard.get': route<
    TenantDashboard,
    undefined,
    undefined,
    { period: DashboardPeriod }
  >('GET', () => '/dashboard'),

  'notifications.list': route<
    TenantNotificationListResponse,
    undefined,
    undefined,
    { limit?: number; offset?: number }
  >('GET', () => '/notifications'),
  'notifications.readAll': route<void>('POST', () => '/notifications/read-all'),

  'me.get': route<EmployeeMe>('GET', () => '/me'),
  'me.update': route<EmployeeMe, UpdateEmployeeMeRequest>('PATCH', () => '/me'),
  'me.changePassword': route<void, ChangePasswordRequest>(
    'POST',
    () => '/me/password',
  ),
  'me.changePin': route<void, ChangePinRequest>('POST', () => '/me/pin'),
  'me.terminals': route<MyTerminal[]>('GET', () => '/me/terminals'),

  'health.get': route<{ status: string }>('GET', () => '/health'),
  'deployment.get': route<DeploymentInfo>('GET', () => '/deployment'),

  'catalog.snapshot': route<
    CatalogSnapshot,
    undefined,
    { storeId: string },
    { sinceVersion?: number }
  >('GET', (p) => `/stores/${encodeURIComponent(p.storeId)}/catalog-snapshot`),

  'receipts.create': route<CreatedReceipt, CreateReceiptRequest>(
    'POST',
    () => '/receipts',
  ),
  'heldReceipts.list': route<HeldReceipt[], undefined, { storeId: string }>(
    'GET',
    (p) => `/stores/${encodeURIComponent(p.storeId)}/held-receipts`,
  ),
  'heldReceipts.create': route<HeldReceipt, HoldReceiptRequest>(
    'POST',
    () => '/held-receipts',
  ),
  'heldReceipts.delete': route<void, undefined, { id: string }>(
    'DELETE',
    (p) => `/held-receipts/${id(p)}`,
  ),

  'shifts.current': route<Shift>('GET', () => '/shifts/current'),
  'shifts.open': route<Shift, OpenShiftRequest>('POST', () => '/shifts'),
  'shifts.cashMovement': route<Shift, CashMovementRequest, { id: string }>(
    'POST',
    (p) => `/shifts/${id(p)}/cash-movements`,
  ),
  'shifts.close': route<ZReport, CloseShiftRequest, { id: string }>(
    'POST',
    (p) => `/shifts/${id(p)}/closure`,
  ),

  'receipts.returnable': route<
    ReturnableReceipt,
    undefined,
    undefined,
    { number: string }
  >('GET', () => '/receipts/returnable'),
  'returns.salesSearch': route<
    SaleSearchItem[],
    undefined,
    undefined,
    { query: string; date: string }
  >('GET', () => '/returns/sales-search'),
  'returns.create': route<CreatedReturn, CreateReturnRequest>(
    'POST',
    () => '/returns',
  ),
  'stock.list': route<StockListResponse, undefined, undefined, StockListQuery>(
    'GET',
    () => '/stock',
  ),
  'stock.products': route<
    StockProductOption[],
    undefined,
    { storeId: string },
    { query?: string; limit?: number }
  >('GET', (p) => `/stores/${encodeURIComponent(p.storeId)}/stock-products`),
  'suppliers.options': route<SupplierOption[]>(
    'GET',
    () => '/suppliers/options',
  ),
  'purchaseOrders.open': route<
    PurchaseOrderOption[],
    undefined,
    undefined,
    { supplierId: string }
  >('GET', () => '/purchase-orders/open'),

  'purchaseOrders.list': route<
    PurchaseOrderListResponse,
    undefined,
    undefined,
    PurchaseOrderListQuery
  >('GET', () => '/purchase-orders'),
  'purchaseOrders.get': route<PurchaseOrder, undefined, { id: string }>(
    'GET',
    (p) => `/purchase-orders/${id(p)}`,
  ),
  'purchaseOrders.create': route<PurchaseOrder, PurchaseOrderInput>(
    'POST',
    () => '/purchase-orders',
  ),
  'purchaseOrders.update': route<
    PurchaseOrder,
    PurchaseOrderInput,
    { id: string }
  >('PUT', (p) => `/purchase-orders/${id(p)}`),
  'purchaseOrders.confirm': route<PurchaseOrder, undefined, { id: string }>(
    'POST',
    (p) => `/purchase-orders/${id(p)}/confirmation`,
  ),
  'purchaseOrders.deficit': route<
    DeficitLine[],
    undefined,
    undefined,
    { storeId: string; supplierId?: string }
  >('GET', () => '/purchase-orders/deficit'),

  'suppliers.list': route<
    SupplierListResponse,
    undefined,
    undefined,
    { limit?: number; offset?: number }
  >('GET', () => '/suppliers'),
  'suppliers.get': route<SupplierCard, undefined, { id: string }>(
    'GET',
    (p) => `/suppliers/${id(p)}`,
  ),
  'suppliers.create': route<Supplier, SupplierInput>(
    'POST',
    () => '/suppliers',
  ),
  'suppliers.update': route<Supplier, SupplierInput, { id: string }>(
    'PUT',
    (p) => `/suppliers/${id(p)}`,
  ),
  'suppliers.pay': route<
    SupplierLedgerEntry,
    SupplierPaymentRequest,
    { id: string }
  >('POST', (p) => `/suppliers/${id(p)}/payments`),

  'catalog.list': route<
    CatalogListResponse,
    undefined,
    undefined,
    CatalogListQuery
  >('GET', () => '/catalog/products'),
  'catalog.get': route<CatalogProductCard, undefined, { id: string }>(
    'GET',
    (p) => `/catalog/products/${id(p)}`,
  ),
  'catalog.create': route<CatalogProduct, CatalogProductInput>(
    'POST',
    () => '/catalog/products',
  ),
  'catalog.update': route<CatalogProduct, CatalogProductInput, { id: string }>(
    'PUT',
    (p) => `/catalog/products/${id(p)}`,
  ),
  'catalog.status': route<
    CatalogProduct,
    UpdateCatalogStatusRequest,
    { id: string }
  >('POST', (p) => `/catalog/products/${id(p)}/status`),
  'catalog.categories': route<Category[]>('GET', () => '/catalog/categories'),
  'catalog.createCategory': route<Category, CategoryInput>(
    'POST',
    () => '/catalog/categories',
  ),
  'catalog.updateCategory': route<Category, CategoryInput, { id: string }>(
    'PUT',
    (p) => `/catalog/categories/${id(p)}`,
  ),
  'catalog.categoryStatus': route<
    Category,
    UpdateCategoryStatusRequest,
    { id: string }
  >('POST', (p) => `/catalog/categories/${id(p)}/status`),
  'catalog.references': route<CatalogReferences>(
    'GET',
    () => '/catalog/references',
  ),
  'catalog.duplicates': route<CatalogDuplicate[]>(
    'GET',
    () => '/catalog/duplicates',
  ),

  'prices.list': route<PriceListResponse, undefined, undefined, PriceListQuery>(
    'GET',
    () => '/prices',
  ),
  'prices.get': route<StorePrice[], undefined, { productId: string }>(
    'GET',
    (p) => `/prices/${encodeURIComponent(p.productId)}`,
  ),
  'prices.update': route<
    PriceListResponse['items'][number],
    UpdatePricesRequest,
    { productId: string }
  >('PUT', (p) => `/prices/${encodeURIComponent(p.productId)}`),
  'priceConflicts.list': route<PriceConflict[]>(
    'GET',
    () => '/price-conflicts',
  ),
  'priceConflicts.resolve': route<
    void,
    ResolvePriceConflictRequest,
    { id: string }
  >('POST', (p) => `/price-conflicts/${id(p)}/resolve`),
  'discountRules.list': route<DiscountRuleDefinition[]>(
    'GET',
    () => '/discount-rules',
  ),
  'discountRules.create': route<DiscountRuleDefinition, DiscountRuleInput>(
    'POST',
    () => '/discount-rules',
  ),
  'discountRules.update': route<
    DiscountRuleDefinition,
    DiscountRuleInput,
    { id: string }
  >('PUT', (p) => `/discount-rules/${id(p)}`),

  'employees.list': route<
    EmployeeListResponse,
    undefined,
    undefined,
    EmployeeListQuery
  >('GET', () => '/employees'),
  'employees.get': route<EmployeeCard, undefined, { id: string }>(
    'GET',
    (p) => `/employees/${id(p)}`,
  ),
  'employees.create': route<EmployeeCard, CreateEmployeeRequest>(
    'POST',
    () => '/employees',
  ),
  'employees.update': route<
    EmployeeCard,
    UpdateEmployeeRequest,
    { id: string }
  >('PUT', (p) => `/employees/${id(p)}`),
  'employees.resetPassword': route<
    void,
    ResetEmployeePasswordRequest,
    { id: string }
  >('POST', (p) => `/employees/${id(p)}/password`),
  'employees.setStatus': route<
    EmployeeCard,
    SetEmployeeStatusRequest,
    { id: string }
  >('POST', (p) => `/employees/${id(p)}/status`),
  'employees.setPin': route<void, SetEmployeePinRequest, { id: string }>(
    'POST',
    (p) => `/employees/${id(p)}/pin`,
  ),
  'roles.list': route<Role[]>('GET', () => '/roles'),
  'roles.create': route<Role, RoleInput>('POST', () => '/roles'),
  'roles.update': route<Role, RoleInput, { id: string }>(
    'PUT',
    (p) => `/roles/${id(p)}`,
  ),
  'terminals.list': route<TenantTerminal[]>('GET', () => '/terminals'),
  'auditLog.list': route<AuditListResponse, undefined, undefined, AuditQuery>(
    'GET',
    () => '/audit-log',
  ),

  'stores.overview': route<StoresOverview>('GET', () => '/stores'),
  'stores.create': route<OwnerStore, CreateStoreRequest>(
    'POST',
    () => '/stores',
  ),
  'stores.update': route<OwnerStore, UpdateOwnerStoreRequest, { id: string }>(
    'PUT',
    (p) => `/stores/${id(p)}`,
  ),
  'legalEntities.list': route<LegalEntitiesResponse>(
    'GET',
    () => '/legal-entities',
  ),
  'legalEntities.create': route<LegalEntity, LegalEntityInput>(
    'POST',
    () => '/legal-entities',
  ),
  'legalEntities.update': route<
    LegalEntity,
    UpdateLegalEntityRequest,
    { id: string }
  >('PATCH', (p) => `/legal-entities/${id(p)}`),
  'stores.closingPreview': route<
    StoreClosingPreview,
    undefined,
    { id: string }
  >('GET', (p) => `/stores/${id(p)}/closing-preview`),
  'stores.close': route<CloseStoreResponse, CloseStoreRequest, { id: string }>(
    'POST',
    (p) => `/stores/${id(p)}/closing`,
  ),
  'services.list': route<TenantService[]>('GET', () => '/services'),
  'services.request': route<
    TenantService,
    undefined,
    { key: TenantServiceKey }
  >('POST', (p) => `/services/${p.key}/requests`),
  'billing.get': route<TenantBilling>('GET', () => '/billing'),

  'reports.get': route<
    ReportTable,
    undefined,
    { kind: ReportKind },
    { from: string; to: string; storeId?: string }
  >('GET', (p) => `/reports/${p.kind}`),
  'export1c.preview': route<
    Export1cPreview,
    undefined,
    undefined,
    { from: string; to: string; storeId?: string }
  >('GET', () => '/exports/1c/preview'),
  'export1c.setArticle': route<
    void,
    SetArticle1cRequest,
    { productId: string }
  >(
    'PUT',
    (p) => `/catalog/products/${encodeURIComponent(p.productId)}/article-1c`,
  ),
  'export1c.run': route<Export1cResult, Export1cRequest>(
    'POST',
    () => '/exports/1c',
  ),

  'settings.get': route<NetworkSettings>('GET', () => '/settings'),
  'settings.update': route<NetworkSettings, NetworkSettings>(
    'PUT',
    () => '/settings',
  ),
  'settings.markups': route<CategoryMarkup[]>('GET', () => '/settings/markups'),
  'settings.updateMarkups': route<CategoryMarkup[], UpdateMarkupsRequest>(
    'PUT',
    () => '/settings/markups',
  ),

  'sync.stores': route<OfflineStoreSync[]>('GET', () => '/sync/stores'),
  'sync.queue': route<
    OfflineQueueResponse,
    undefined,
    undefined,
    { limit?: number; offset?: number }
  >('GET', () => '/sync/queue'),
  'sync.run': route<SyncRunResult>('POST', () => '/sync/runs'),
  'catalog.resolveDuplicate': route<
    void,
    ResolveDuplicateRequest,
    { id: string }
  >('POST', (p) => `/catalog/duplicates/${id(p)}/resolve`),

  'documents.unpostCheck': route<
    UnpostCheck,
    undefined,
    { kind: StockDocumentKind; id: string }
  >('GET', (p) => `/stock-documents/${p.kind}/${id(p)}/unposting-check`),

  'goodsReceipts.list': route<
    GoodsReceiptListResponse,
    undefined,
    undefined,
    DocumentListQuery
  >('GET', () => '/goods-receipts'),
  'goodsReceipts.get': route<GoodsReceipt, undefined, { id: string }>(
    'GET',
    (p) => `/goods-receipts/${id(p)}`,
  ),
  'goodsReceipts.create': route<GoodsReceipt, GoodsReceiptInput>(
    'POST',
    () => '/goods-receipts',
  ),
  'goodsReceipts.update': route<
    GoodsReceipt,
    GoodsReceiptInput,
    { id: string }
  >('PUT', (p) => `/goods-receipts/${id(p)}`),
  'goodsReceipts.post': route<GoodsReceipt, undefined, { id: string }>(
    'POST',
    (p) => `/goods-receipts/${id(p)}/posting`,
  ),
  'goodsReceipts.unpost': route<GoodsReceipt, undefined, { id: string }>(
    'POST',
    (p) => `/goods-receipts/${id(p)}/unposting`,
  ),

  'writeOffs.list': route<
    WriteOffListResponse,
    undefined,
    undefined,
    DocumentListQuery
  >('GET', () => '/write-offs'),
  'writeOffs.get': route<WriteOff, undefined, { id: string }>(
    'GET',
    (p) => `/write-offs/${id(p)}`,
  ),
  'writeOffs.create': route<WriteOff, WriteOffInput>(
    'POST',
    () => '/write-offs',
  ),
  'writeOffs.update': route<WriteOff, WriteOffInput, { id: string }>(
    'PUT',
    (p) => `/write-offs/${id(p)}`,
  ),
  'writeOffs.post': route<WriteOff, undefined, { id: string }>(
    'POST',
    (p) => `/write-offs/${id(p)}/posting`,
  ),
  'writeOffs.unpost': route<WriteOff, undefined, { id: string }>(
    'POST',
    (p) => `/write-offs/${id(p)}/unposting`,
  ),

  'supplierReturns.list': route<
    SupplierReturnListResponse,
    undefined,
    undefined,
    DocumentListQuery
  >('GET', () => '/supplier-returns'),
  'supplierReturns.get': route<SupplierReturn, undefined, { id: string }>(
    'GET',
    (p) => `/supplier-returns/${id(p)}`,
  ),
  'supplierReturns.create': route<SupplierReturn, SupplierReturnInput>(
    'POST',
    () => '/supplier-returns',
  ),
  'supplierReturns.update': route<
    SupplierReturn,
    SupplierReturnInput,
    { id: string }
  >('PUT', (p) => `/supplier-returns/${id(p)}`),
  'supplierReturns.post': route<SupplierReturn, undefined, { id: string }>(
    'POST',
    (p) => `/supplier-returns/${id(p)}/posting`,
  ),
  'supplierReturns.unpost': route<SupplierReturn, undefined, { id: string }>(
    'POST',
    (p) => `/supplier-returns/${id(p)}/unposting`,
  ),

  'stockCounts.list': route<
    {
      items: StockCountListItem[];
      total: number;
      limit: number;
      offset: number;
    },
    undefined,
    undefined,
    DocumentListQuery
  >('GET', () => '/stock-counts'),
  'stockCounts.get': route<StockCount, undefined, { id: string }>(
    'GET',
    (p) => `/stock-counts/${id(p)}`,
  ),
  'stockCounts.start': route<StockCount, StartStockCountRequest>(
    'POST',
    () => '/stock-counts',
  ),
  'stockCounts.save': route<StockCount, SaveStockCountRequest, { id: string }>(
    'PUT',
    (p) => `/stock-counts/${id(p)}`,
  ),
  'stockCounts.post': route<StockCount, undefined, { id: string }>(
    'POST',
    (p) => `/stock-counts/${id(p)}/posting`,
  ),
  'stockCounts.unpost': route<StockCount, undefined, { id: string }>(
    'POST',
    (p) => `/stock-counts/${id(p)}/unposting`,
  ),

  'transfers.overview': route<
    TransferOverview,
    undefined,
    undefined,
    { status?: string }
  >('GET', () => '/transfers/overview'),
  'transfers.get': route<Transfer, undefined, { id: string }>(
    'GET',
    (p) => `/transfers/${id(p)}`,
  ),
  'transfers.create': route<Transfer, TransferInput>(
    'POST',
    () => '/transfers',
  ),
  'transfers.accept': route<Transfer, AcceptTransferRequest, { id: string }>(
    'POST',
    (p) => `/transfers/${id(p)}/acceptance`,
  ),
  'transfers.resolve': route<
    Transfer,
    { resolution: DiscrepancyResolution },
    { id: string }
  >('POST', (p) => `/transfers/${id(p)}/discrepancy-resolution`),
  'transferRequests.get': route<TransferRequest, undefined, { id: string }>(
    'GET',
    (p) => `/transfer-requests/${id(p)}`,
  ),
  'transferRequests.create': route<TransferRequest, TransferRequestInput>(
    'POST',
    () => '/transfer-requests',
  ),
  'transferRequests.reject': route<
    TransferRequest,
    { reason: RejectionReason; comment: string },
    { id: string }
  >('POST', (p) => `/transfer-requests/${id(p)}/rejection`),

  'returns.list': route<
    ReturnListResponse,
    undefined,
    undefined,
    { reason?: ReturnReason; limit?: number; offset?: number }
  >('GET', () => '/returns'),
} as const;

export type ApiRouteKey = keyof typeof apiRoutes;

type RouteOf<K extends ApiRouteKey> = (typeof apiRoutes)[K];
type Parts<K extends ApiRouteKey> =
  RouteOf<K> extends RouteDef<infer P, infer Q, infer B, infer R>
    ? { params: P; query: Q; body: B; response: R }
    : never;
export type ApiParams<K extends ApiRouteKey> = Parts<K>['params'];
export type ApiQuery<K extends ApiRouteKey> = Parts<K>['query'];
export type ApiBody<K extends ApiRouteKey> = Parts<K>['body'];
export type ApiResponse<K extends ApiRouteKey> = Parts<K>['response'];

/** Serializes defined query values; booleans and numbers as strings. */
export function toQueryString(
  query: Record<string, QueryValue> | undefined,
): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
