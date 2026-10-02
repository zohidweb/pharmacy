/*
 * Fake /api/v1 of the e2e tests (ADR-0009): answers the POS routes over the real HTTP client of
 * the production build through page.route, typed by the contracts of @pharmacy/shared-dto. It
 * keeps the rules the offline tests rely on — the Idempotency-Key of a receipt (a retry returns the
 * first answer), problem+json errors — and can simulate an outage or a failure of the next sale.
 * Synthetic data only. When apps/api exists, the same scenarios run against the real stack.
 */
import { roleTemplates } from '@pharmacy/shared-domain';
import type {
  BoundTerminal,
  CatalogSnapshot,
  CreatedReceipt,
  CreateReceiptRequest,
  EmployeeSession,
  PosProduct,
  SessionStore,
  Shift,
} from '@pharmacy/shared-dto';
import type { BrowserContext, Route } from '@playwright/test';

export const PARACETAMOL = '4870001000017';
export const CASHIER_PIN = '2580';

const store: SessionStore = {
  id: 'store-3',
  name: 'Аптека №3 · Рудаки',
  address: 'ул. Рудаки, 12',
  mode: 'cloud',
};

const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function products(): PosProduct[] {
  return [
    {
      id: 'p-paracetamol',
      name: 'Парацетамол 500 мг, таб. №10',
      inn: 'Paracetamol',
      manufacturer: 'Фармстандарт',
      country: 'RU',
      form: 'таблетки 500 мг',
      categoryId: 'cat-analgesics',
      barcodes: [PARACETAMOL],
      piecesPerPack: 10,
      divisible: true,
      prescription: 'none',
      priceMinor: 450,
      piecePriceMinor: 45,
      batches: [
        {
          id: 'b-p-2311',
          number: 'P-2311',
          expiresOn: dateIn(180),
          quantityPieces: 480,
        },
      ],
    },
    {
      id: 'p-vitamin-d3',
      name: 'Витамин D3 2000 МЕ, капс. №60',
      inn: 'Colecalciferol',
      manufacturer: 'Solgar',
      country: 'US',
      form: 'капсулы 2000 МЕ',
      categoryId: 'cat-vitamins',
      barcodes: ['4870001000079'],
      piecesPerPack: 60,
      divisible: false,
      prescription: 'none',
      priceMinor: 6_500,
      piecePriceMinor: null,
      batches: [
        {
          id: 'b-v-9021',
          number: 'V-9021',
          expiresOn: dateIn(500),
          quantityPieces: 600,
        },
      ],
    },
  ];
}

const payment = () => ({ count: 0, amountMinor: 0 });

function openShift(): Shift {
  return {
    id: 'shift-218',
    number: 218,
    storeId: store.id,
    status: 'open',
    openedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    openedBy: 'Зарина Р.',
    closedAt: null,
    receipts: 0,
    byMethod: {
      cash: payment(),
      card: payment(),
      qr: payment(),
      nfc: payment(),
    },
    returns: payment(),
    revenueMinor: 0,
    cash: {
      openingMinor: 50_000,
      salesMinor: 0,
      inMinor: 0,
      outMinor: 0,
      returnsMinor: 0,
      expectedMinor: 50_000,
    },
    events: [],
  };
}

function cashierSession(): EmployeeSession {
  return {
    employee: {
      id: 'emp-cashier',
      fullName: 'Зарина Рахимова',
      login: 'zarina',
      phone: '+992 93 220-77-04',
    },
    tenant: { id: 'tenant-shifo', name: 'Шифо' },
    role: {
      id: 'role-cashier',
      name: 'Фармацевт-кассир',
      system: false,
      templateKey: 'cashier',
    },
    permissions: [...roleTemplates.cashier.permissions],
    scope: 'stores',
    stores: [store],
    currentStoreId: store.id,
    auth: 'pin',
    authenticatedAt: new Date().toISOString(),
    terminalId: 'term-3-1',
    impersonation: null,
    locale: 'ru',
  };
}

const terminal: BoundTerminal = {
  id: 'term-3-1',
  name: 'Касса 1 · Аптека №3',
  store,
  cashiers: [{ employeeId: 'emp-cashier', shortName: 'Зарина Р.' }],
  pinLength: 4,
};

export interface ReceivedReceipt {
  idempotencyKey: string | null;
  correlationId: string | null;
  body: CreateReceiptRequest;
}

export class FakeApi {
  /** False — every API request fails as a dropped connection. */
  online = true;
  signedIn = true;
  /** Every POST /receipts that reached the server, retries included. */
  readonly receiptRequests: ReceivedReceipt[] = [];
  /** Idempotency-Key → the first answer (a retry gets it again, no second sale). */
  private readonly receipts = new Map<string, CreatedReceipt>();
  private nextReceiptNumber = 1042;
  private failNextReceipt: { status: number; code: string } | null = null;
  private loseNextAnswer = false;
  private readonly catalog: CatalogSnapshot = {
    version: 41,
    full: true,
    products: products(),
    removedProductIds: [],
    categories: [
      { id: 'cat-analgesics', name: 'Анальгетики' },
      { id: 'cat-vitamins', name: 'Витамины' },
    ],
    discountRules: [],
    settings: {
      networkName: 'Аптечная сеть «Шифо»',
      storeName: store.name,
      storeAddress: store.address,
      taxId: '020012345',
      receiptFooter: 'Спасибо за покупку!',
      returnWindowDays: 14,
    },
  };
  private readonly shift = openShift();

  /** Distinct sales the server keeps (by Idempotency-Key). */
  get sales() {
    return this.receipts.size;
  }

  /** The next sale is taken by the server, but its answer is lost on the way back. */
  loseNextReceiptAnswer() {
    this.loseNextAnswer = true;
  }

  /** The next POST /receipts answers this error once (e.g. 409 → quarantine). */
  failNextReceiptWith(status: number, code: string) {
    this.failNextReceipt = { status, code };
  }

  async install(context: BrowserContext) {
    await context.route('**/api/v1/**', (route) => this.handle(route));
  }

  private async handle(route: Route) {
    if (!this.online) {
      await route.abort('internetdisconnected');
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    const problem = (status: number, code: string) =>
      route.fulfill({
        status,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status, code, errors: [] }),
      });
    const session = () =>
      this.signedIn ? null : problem(401, 'unauthenticated');

    switch (`${method} ${path}`) {
      case 'GET /health':
        return json({ status: 'ok' });
      case 'GET /deployment':
        return json({ kind: 'cloud' });
      case 'GET /terminals/current':
        return json(terminal);
      case 'POST /terminal-sessions': {
        const body = request.postDataJSON() as { pin: string };
        if (body.pin !== CASHIER_PIN) return problem(401, 'invalid_pin');
        this.signedIn = true;
        return json(cashierSession(), 201);
      }
      case 'POST /sessions':
        return problem(401, 'invalid_credentials');
      case 'DELETE /sessions/current':
        this.signedIn = false;
        return route.fulfill({ status: 204 });
      case 'GET /sessions/current':
        return session() ?? json(cashierSession());
      case 'GET /notifications':
        return (
          session() ??
          json({ items: [], total: 0, limit: 20, offset: 0, unread: 0 })
        );
      case 'GET /sync/status':
        return problem(404, 'not_found');
      case 'GET /shifts/current':
        return session() ?? json(this.shift);
      case `GET /stores/${store.id}/catalog-snapshot`: {
        if (!this.signedIn) return problem(401, 'unauthenticated');
        const since = Number(url.searchParams.get('sinceVersion'));
        return json(
          since === this.catalog.version
            ? { ...this.catalog, full: false, products: [] }
            : this.catalog,
        );
      }
      case `GET /stores/${store.id}/held-receipts`:
        return session() ?? json([]);
      case 'POST /receipts':
        return session() ?? this.createReceipt(route);
      default:
        return problem(404, 'not_found');
    }
  }

  private async createReceipt(route: Route) {
    const request = route.request();
    const headers = request.headers();
    const body = request.postDataJSON() as CreateReceiptRequest;
    const key = headers['idempotency-key'] ?? null;
    this.receiptRequests.push({
      idempotencyKey: key,
      correlationId: headers['x-correlation-id'] ?? null,
      body,
    });
    if (this.failNextReceipt) {
      const { status, code } = this.failNextReceipt;
      this.failNextReceipt = null;
      return route.fulfill({
        status,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status, code, errors: [] }),
      });
    }
    const seen = key ? this.receipts.get(key) : undefined;
    const created: CreatedReceipt = seen ?? {
      id: body.id,
      number: String(this.nextReceiptNumber++),
      fiscal: null,
      discrepancies: 0,
    };
    if (key && !seen) this.receipts.set(key, created);
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      return route.abort('connectionreset');
    }
    return route.fulfill({
      status: seen ? 200 : 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  }
}
