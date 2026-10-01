/*
 * In-memory mock transport: answers the same routes and errors (problem codes) as apps/api will,
 * so screens are built against the real contract. Filtering, sorting and paging happen here as
 * they will on the server (limit/offset). The mock session lives in sessionStorage to survive a
 * reload in development. Enabled only by NEXT_PUBLIC_API_MOCKS=true.
 */
import type {
  OperatorSession,
  StoreDetails,
  StoreSummary,
  TenantDetails,
  TenantListFilter,
  TenantListItem,
} from '@pharmacy/shared-dto';
import { ApiError, type ApiTransport } from '../client';
import type {
  ApiBody,
  ApiParams,
  ApiQuery,
  ApiResponse,
  ApiRouteKey,
} from '../routes';
import { mockDb, mockStats } from './db';
import { demoOperator, demoOperatorPassword } from './fixtures';

const SESSION_KEY = 'pharmacy-admin-mock-session';
const LATENCY_MS = 300;

function readSession(): OperatorSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as OperatorSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: OperatorSession | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): the mock session lives only until reload
  }
}

interface Request<K extends ApiRouteKey> {
  params: ApiParams<K>;
  query: ApiQuery<K>;
  body: ApiBody<K>;
  correlationId: string;
}

type Handlers = {
  [K in ApiRouteKey]: (request: Request<K>) => ApiResponse<K>;
};

const notFound = (correlationId: string) =>
  new ApiError(404, 'not_found', correlationId);

function findTenant(id: string, correlationId: string): TenantDetails {
  const tenant = mockDb().tenants.find((t) => t.id === id);
  if (!tenant) throw notFound(correlationId);
  return tenant;
}

function findStore(id: string, correlationId: string): StoreDetails {
  const found = mockDb().stores.find((s) => s.id === id);
  if (!found) throw notFound(correlationId);
  return found;
}

function matchesFilter(
  tenant: TenantListItem,
  filter: TenantListFilter,
): boolean {
  switch (filter) {
    case 'active':
      return tenant.status === 'active' && !tenant.overdue;
    case 'unpaid':
      return tenant.status === 'active' && tenant.overdue;
    case 'blocked':
      return tenant.status === 'blocked';
    default:
      return true;
  }
}

function toSummary(details: StoreDetails): StoreSummary {
  const {
    id,
    tenantId,
    name,
    address,
    mode,
    status,
    closedOn,
    paidUntil,
    licenseValidUntil,
    lastSyncAt,
    monthSalesMinor,
  } = details;
  return {
    id,
    tenantId,
    name,
    address,
    mode,
    status,
    closedOn,
    paidUntil,
    licenseValidUntil,
    lastSyncAt,
    monthSalesMinor,
  };
}

function toListItem(tenant: TenantDetails): TenantListItem {
  const { inn: _inn, joinedOn: _joinedOn, block: _block, ...item } = tenant;
  return item;
}

function audit(
  tenantId: string,
  action: string,
  storeName: string | null = null,
) {
  const entries = (mockDb().audit[tenantId] ??= []);
  entries.unshift({
    id: `a-${Date.now()}`,
    at: new Date().toISOString(),
    actorName: demoOperator.fullName,
    actorIsPlatformOperator: true,
    storeName,
    action,
  });
}

const handlers: Handlers = {
  'operator.sessions.create': ({ body, correlationId }) => {
    if (
      body?.login.trim().toLowerCase() !== demoOperator.login ||
      body.password !== demoOperatorPassword
    ) {
      throw new ApiError(401, 'invalid_credentials', correlationId);
    }
    const session: OperatorSession = {
      operator: demoOperator,
      authenticatedAt: new Date().toISOString(),
    };
    writeSession(session);
    return session;
  },
  'operator.sessions.current': ({ correlationId }) => {
    const session = readSession();
    if (!session) throw new ApiError(401, 'unauthenticated', correlationId);
    return session;
  },
  'operator.sessions.delete': () => {
    writeSession(null);
  },
  'operator.impersonations.create': ({ body, correlationId }) => {
    const tenant = findTenant(body.tenantId, correlationId);
    if (tenant.status === 'blocked') {
      throw new ApiError(409, 'tenant_blocked', correlationId);
    }
    audit(
      tenant.id,
      `Начат сеанс «от имени» владельца. Причина: ${body.reason}`,
    );
    // No client-product origin in mock mode: the screen reports the started session instead.
    return {
      impersonationId: `imp-${Date.now()}`,
      handoffCode: 'mock',
      handoffUrl: '',
    };
  },

  'tenants.list': ({ query }) => {
    const filter = query?.filter ?? 'all';
    const q = (query?.q ?? '').trim().toLocaleLowerCase('ru');
    const all = mockDb().tenants.map(toListItem);
    const searched = q
      ? all.filter((t) =>
          [t.name, t.owner.fullName, t.city].some((value) =>
            value.toLocaleLowerCase('ru').includes(q),
          ),
        )
      : all;
    const counts = {
      all: searched.length,
      active: searched.filter((t) => matchesFilter(t, 'active')).length,
      unpaid: searched.filter((t) => matchesFilter(t, 'unpaid')).length,
      blocked: searched.filter((t) => matchesFilter(t, 'blocked')).length,
    };
    const sortKey = query?.sort ?? 'name';
    const direction = query?.direction === 'desc' ? -1 : 1;
    const value = (t: TenantListItem): string | number => {
      switch (sortKey) {
        case 'owner':
          return t.owner.fullName;
        case 'stores':
          return t.cloudStores + t.offlineStores;
        case 'paidUntil':
          return t.paidUntil ?? '';
        case 'monthlyCharge':
          return t.monthlyChargeMinor;
        default:
          return t.name;
      }
    };
    const items = searched
      .filter((t) => matchesFilter(t, filter))
      .sort((a, b) => {
        const left = value(a);
        const right = value(b);
        const order =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right), 'ru');
        return order * direction;
      });
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      counts,
    };
  },
  'tenants.create': ({ body, correlationId }) => {
    const db = mockDb();
    if (db.tenants.some((t) => t.inn === body.inn)) {
      throw new ApiError(409, 'inn_taken', correlationId, [
        { field: 'inn', code: 'taken' },
      ]);
    }
    const id = `t-${db.tenants.length + 1}-${Date.now()}`;
    const cloud = body.firstStore.mode === 'cloud';
    db.tenants.push({
      id,
      name: body.name,
      city: body.city,
      inn: body.inn,
      owner: body.owner,
      joinedOn: new Date().toISOString().slice(0, 10),
      status: 'active',
      overdue: false,
      block: null,
      cloudStores: cloud ? 1 : 0,
      offlineStores: cloud ? 0 : 1,
      paidUntil: cloud ? body.paidUntil : null,
      monthlyChargeMinor: cloud ? body.pricePerStoreMinor : 0,
    });
    db.stores.push({
      id: `s-${Date.now()}`,
      tenantId: id,
      tenantName: body.name,
      name: body.firstStore.name,
      address: body.firstStore.address,
      mode: body.firstStore.mode,
      status: 'active',
      closedOn: null,
      paidUntil: cloud ? body.paidUntil : null,
      licenseValidUntil: null,
      lastSyncAt: null,
      monthSalesMinor: 0,
      managerName: '',
      managerPhone: '',
      cashiers: 0,
      connectedOn: new Date().toISOString().slice(0, 10),
      installedVersion: null,
      latestVersion: '2.4.0',
      monthReceipts: 0,
      license: null,
      syncHistory: [],
      syncQueue: [],
    });
    audit(id, 'Компания создана оператором платформы');
    return { id };
  },
  'tenants.get': ({ params, correlationId }) =>
    findTenant(params.id, correlationId),
  'tenants.block': ({ params, body, correlationId }) => {
    const tenant = findTenant(params.id, correlationId);
    tenant.status = 'blocked';
    tenant.block = {
      blockedAt: new Date().toISOString(),
      blockedBy: demoOperator.fullName,
      reason: body.reason,
    };
    audit(tenant.id, `Компания заблокирована. Причина: ${body.reason}`);
    return tenant;
  },
  'tenants.unblock': ({ params, correlationId }) => {
    const tenant = findTenant(params.id, correlationId);
    tenant.status = 'active';
    tenant.block = null;
    audit(tenant.id, 'Компания разблокирована');
    return tenant;
  },
  'tenants.stores': ({ params, correlationId }) => {
    findTenant(params.id, correlationId);
    return mockDb()
      .stores.filter((s) => s.tenantId === params.id)
      .map(toSummary);
  },
  'tenants.invoices': ({ params }) => mockDb().invoices[params.id] ?? [],
  'tenants.payments': ({ params }) => mockDb().payments[params.id] ?? [],
  'tenants.services': ({ params }) => mockDb().services[params.id] ?? [],
  'tenants.stats': ({ params, correlationId }) => {
    findTenant(params.id, correlationId);
    return mockStats(params.id);
  },
  'tenants.audit': ({ params, query }) => {
    const items = mockDb().audit[params.id] ?? [];
    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  },

  'stores.get': ({ params, correlationId }) =>
    findStore(params.id, correlationId),
  'stores.update': ({ params, body, correlationId }) => {
    const target = findStore(params.id, correlationId);
    Object.assign(target, body);
    audit(target.tenantId, 'Изменены параметры точки', target.name);
    return target;
  },
  'stores.updateLicenseSettings': ({ params, body, correlationId }) => {
    const target = findStore(params.id, correlationId);
    if (!target.license) throw new ApiError(409, 'not_offline', correlationId);
    target.license = { ...target.license, ...body };
    audit(
      target.tenantId,
      'Изменены параметры лицензии и синхронизации',
      target.name,
    );
    return target;
  },
  'stores.requestSync': ({ params, correlationId }) => {
    const target = findStore(params.id, correlationId);
    if (target.mode !== 'offline')
      throw new ApiError(409, 'not_offline', correlationId);
    audit(target.tenantId, 'Запрошена внеочередная синхронизация', target.name);
  },
  'stores.migrateToCloud': ({ params, body, correlationId }) => {
    const target = findStore(params.id, correlationId);
    if (target.mode !== 'offline')
      throw new ApiError(409, 'not_offline', correlationId);
    if (target.syncQueue.some((item) => item.operations > 0)) {
      throw new ApiError(409, 'sync_queue_not_empty', correlationId);
    }
    Object.assign(target, {
      mode: 'cloud',
      paidUntil: body.paidUntil,
      license: null,
      licenseValidUntil: null,
    });
    audit(target.tenantId, 'Точка переведена в облако', target.name);
    return target;
  },
};

export const mockTransport: ApiTransport = async (
  route,
  options,
  correlationId,
) => {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (options.signal?.aborted) throw new ApiError(0, 'network', correlationId);
  const handler = handlers[route] as (
    request: Request<typeof route>,
  ) => ApiResponse<typeof route>;
  // copy: callers must not mutate the mock database through responses
  const result = handler({
    params: options.params as ApiParams<typeof route>,
    query: options.query as ApiQuery<typeof route>,
    body: options.body as ApiBody<typeof route>,
    correlationId,
  });
  return result === undefined
    ? result
    : (JSON.parse(JSON.stringify(result)) as typeof result);
};
