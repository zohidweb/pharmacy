/*
 * Synthetic data of the «Сайт» screens (connection requests, articles, legal documents, pictures,
 * settings of the public site). Fictional networks, people and texts only; the phones and INNs are
 * placeholders, the pictures are one-pixel PNGs.
 */
import type {
  Article,
  ConnectionRequest,
  LegalDocumentDraft,
  LegalDocumentRevision,
  SiteMedia,
  SiteSettings,
} from '@pharmacy/shared-dto';
import { demoOperator } from './fixtures';

/** One-pixel PNGs (valid files): the seed pictures and a sample for uploads in development. */
export const MOCK_PNG_RED =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4oaEBAALUARkFUI+kAAAAAElFTkSuQmCC';
export const MOCK_PNG_BLUE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC';

export interface SiteDb {
  requests: ConnectionRequest[];
  articles: Article[];
  /** Drafts of the next revision: at most one per kind and language. */
  legalDrafts: LegalDocumentDraft[];
  /** Published revisions with the text, the newest first. */
  legalRevisions: LegalDocumentRevision[];
  media: SiteMedia[];
  settings: SiteSettings;
}

/** The size of a base64 payload in bytes and, for a PNG, its pixels (IHDR); other types — a stub size. */
export function describeImage(dataBase64: string): {
  byteSize: number;
  width: number;
  height: number;
} {
  const padding = dataBase64.endsWith('==')
    ? 2
    : dataBase64.endsWith('=')
      ? 1
      : 0;
  const byteSize = Math.floor((dataBase64.length * 3) / 4) - padding;
  try {
    const head = atob(dataBase64.slice(0, 44));
    if (head.startsWith('\x89PNG')) {
      const word = (at: number) =>
        (head.charCodeAt(at) << 24) |
        (head.charCodeAt(at + 1) << 16) |
        (head.charCodeAt(at + 2) << 8) |
        head.charCodeAt(at + 3);
      return { byteSize, width: word(16), height: word(20) };
    }
  } catch {
    // not a valid base64 prefix: the stub below
  }
  return { byteSize, width: 1, height: 1 };
}

function request(
  partial: Partial<ConnectionRequest> &
    Pick<ConnectionRequest, 'id' | 'networkName' | 'city' | 'contactName'>,
): ConnectionRequest {
  return {
    status: 'new',
    storeCount: 1,
    phone: '+992000000000',
    email: null,
    inn: null,
    callTime: null,
    comment: null,
    locale: 'ru',
    privacyDocumentId: 'ldr-privacy-ru-1',
    createdAt: '2026-10-27T08:00:00Z',
    assignedTo: null,
    operatorNote: null,
    rejectReason: null,
    tenantId: null,
    decidedAt: null,
    anonymizedAt: null,
    similarTenants: [],
    ...partial,
  };
}

export function seedSite(): SiteDb {
  const requests: ConnectionRequest[] = [
    request({
      id: 'cr-1',
      networkName: 'Аптека Образцовая',
      city: 'Душанбе',
      contactName: 'Заявитель Первый',
      phone: '+992000000011',
      email: 'first@example.test',
      inn: '000000011',
      storeCount: 3,
      callTime: 'после 14:00',
      comment: 'Хотим перейти с учёта в таблицах, нужна касса и склад.',
      createdAt: '2026-10-28T06:30:00Z',
      similarTenants: [{ id: 't-1', name: 'Демо Фарм' }],
    }),
    request({
      id: 'cr-2',
      networkName: 'Фарм Пример',
      city: 'Худжанд',
      contactName: 'Заявитель Второй',
      phone: '+992000000012',
      storeCount: 12,
      locale: 'tg',
      createdAt: '2026-10-27T15:10:00Z',
    }),
    request({
      id: 'cr-3',
      status: 'in_progress',
      networkName: 'Здоровье Тест',
      city: 'Бохтар',
      contactName: 'Заявитель Третий',
      phone: '+992000000013',
      email: 'third@example.test',
      inn: '000000013',
      storeCount: 2,
      createdAt: '2026-10-26T09:45:00Z',
      assignedTo: { id: demoOperator.id, fullName: demoOperator.fullName },
      operatorNote: 'Созвонились, ждём документы.',
    }),
    request({
      id: 'cr-4',
      status: 'connected',
      networkName: 'Тест Аптека',
      city: 'Бохтар',
      contactName: 'Владелец Тест',
      phone: '+992000000014',
      inn: '000000003',
      storeCount: 1,
      createdAt: '2026-08-18T10:00:00Z',
      assignedTo: { id: demoOperator.id, fullName: demoOperator.fullName },
      tenantId: 't-3',
      decidedAt: '2026-08-20T07:00:00Z',
    }),
    request({
      id: 'cr-5',
      status: 'rejected',
      networkName: 'Магазин у дома',
      city: 'Куляб',
      contactName: 'Заявитель Пятый',
      phone: '+992000000015',
      storeCount: 1,
      createdAt: '2026-10-20T12:20:00Z',
      assignedTo: { id: demoOperator.id, fullName: demoOperator.fullName },
      rejectReason: 'Не аптека: розничный магазин без лицензии.',
      decidedAt: '2026-10-21T08:15:00Z',
    }),
  ];

  const articles: Article[] = [
    {
      id: 'ar-1',
      slug: 'kak-vesti-uchet-ostatkov',
      status: 'published',
      coverMediaId: 'sm-1',
      publishedAt: '2026-10-20T07:00:00Z',
      updatedAt: '2026-10-21T09:00:00Z',
      version: 3,
      translations: {
        ru: {
          title: 'Как вести учёт остатков в аптеке',
          excerpt: 'Партии, сроки годности и инвентаризация без таблиц.',
          body: '## Партии\n\nКаждый приход — отдельная партия со сроком годности.\n\n- остаток считается по движениям\n- просрочка видна заранее\n\nПодробнее — на странице [тарифов](/pricing).',
          seoTitle: 'Учёт остатков в аптеке',
          seoDescription:
            'Как учитывать партии и сроки годности в аптечной сети.',
        },
        tg: {
          title: 'Чӣ тавр бақияи доруро дар дорухона ҳисоб кардан лозим',
          excerpt: 'Партияҳо, мӯҳлати истифода ва ҳисобкунӣ бе ҷадвал.',
          body: '## Партияҳо\n\nҲар воридот партияи алоҳида бо мӯҳлати истифода аст.',
          seoTitle: '',
          seoDescription: '',
        },
      },
    },
    {
      id: 'ar-2',
      slug: 'novosti-platformy',
      status: 'draft',
      coverMediaId: null,
      publishedAt: null,
      updatedAt: '2026-10-27T11:30:00Z',
      version: 1,
      translations: {
        ru: {
          title: 'Новости платформы',
          excerpt: '',
          body: 'Черновик новости.',
          seoTitle: '',
          seoDescription: '',
        },
      },
    },
    {
      id: 'ar-3',
      slug: 'staraya-akciya',
      status: 'unpublished',
      coverMediaId: null,
      publishedAt: '2026-09-01T07:00:00Z',
      updatedAt: '2026-10-05T10:00:00Z',
      version: 4,
      translations: {
        ru: {
          title: 'Акция сентября',
          excerpt: 'Скидка на подключение второй точки.',
          body: 'Акция закончилась.',
          seoTitle: '',
          seoDescription: '',
        },
      },
    },
    {
      id: 'ar-4',
      slug: 'otmenennaya-statya',
      status: 'archived',
      coverMediaId: null,
      publishedAt: null,
      updatedAt: '2026-09-15T10:00:00Z',
      version: 2,
      translations: {
        ru: {
          title: 'Отменённая статья',
          excerpt: '',
          body: 'Не пригодилась.',
          seoTitle: '',
          seoDescription: '',
        },
      },
    },
  ];

  const text = (kind: 'offer' | 'privacy', locale: 'ru' | 'tg') => {
    const ru = locale === 'ru';
    return {
      title:
        kind === 'offer'
          ? ru
            ? 'Публичная оферта'
            : 'Оферта'
          : ru
            ? 'Политика обработки персональных данных'
            : 'Сиёсати коркарди маълумоти шахсӣ',
      body: ru
        ? '## Общие положения\n\nТекст документа для разработки интерфейса.'
        : '## Муқаррароти умумӣ\n\nМатни ҳуҷҷат барои таҳияи интерфейс.',
    };
  };
  const legalRevisions: LegalDocumentRevision[] = (
    ['offer', 'privacy'] as const
  ).flatMap((kind) =>
    (['ru', 'tg'] as const).map((locale) => ({
      id: `ldr-${kind}-${locale}-1`,
      kind,
      locale,
      ...text(kind, locale),
      effectiveFrom: '2026-10-01',
      publishedAt: '2026-09-30T07:00:00Z',
    })),
  );
  const legalDrafts: LegalDocumentDraft[] = [
    {
      kind: 'offer',
      locale: 'ru',
      title: 'Публичная оферта',
      body: '## Общие положения\n\nНовая редакция: изменён порядок оплаты.',
      effectiveFrom: '2026-11-15',
      updatedAt: '2026-10-27T12:00:00Z',
    },
  ];

  const media: SiteMedia[] = [
    {
      id: 'sm-1',
      contentType: 'image/png',
      ...describeImage(MOCK_PNG_RED),
      alt: 'Красная точка',
      createdAt: '2026-10-19T09:00:00Z',
    },
    {
      id: 'sm-2',
      contentType: 'image/png',
      ...describeImage(MOCK_PNG_BLUE),
      alt: 'Синяя точка',
      createdAt: '2026-10-18T09:00:00Z',
    },
  ];

  const settings: SiteSettings = {
    name: { ru: 'Пример Платформа', tg: 'Платформаи намуна' },
    tagline: {
      ru: 'Учёт для аптечных сетей',
      tg: 'Ҳисобдорӣ барои шабакаҳои дорухонаҳо',
    },
    seoDescription: {
      ru: 'Касса, склад и отчёты для аптек в одном сервисе.',
      tg: 'Касса, анбор ва ҳисоботҳо барои дорухонаҳо дар як хизматрасонӣ.',
    },
    address: {
      ru: 'Душанбе, ул. Примерная, 1',
      tg: 'Душанбе, кӯчаи Намуна, 1',
    },
    workingHours: { ru: 'Пн–Пт, 9:00–18:00', tg: 'Дш–Ҷм, 9:00–18:00' },
    logoMediaId: 'sm-1',
    faviconMediaId: null,
    ogImageMediaId: 'sm-2',
    phone: '+992000000100',
    email: 'info@example.test',
    telegramUrl: 'https://t.me/example_test',
    whatsappUrl: '',
    updatedAt: '2026-10-25T10:00:00Z',
  };

  return { requests, articles, legalDrafts, legalRevisions, media, settings };
}
