'use client';

/*
 * Dev-only catalog: every libs/ui component in its variants and states, on synthetic data.
 * Texts are inline on purpose (developer page, not part of the product UI).
 */
import { formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Avatar,
  BarChart,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Chip,
  ChipGroup,
  CountBadge,
  DataTable,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  icons,
  KpiTile,
  OtpField,
  Pagination,
  Popover,
  RadioCardGroup,
  SegmentedControl,
  Select,
  StatusPill,
  Stepper,
  Switch,
  Tabs,
  TextareaField,
  TextField,
  ToastProvider,
  useToast,
  type DataTableColumn,
  type IconName,
  type SortState,
  type StatusTone,
} from '@pharmacy/ui';
import { useMemo, useState, type ReactNode } from 'react';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `kit-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <Card as="section" aria-labelledby={id}>
      <CardHeader title={title} titleId={id} />
      <div className="flex flex-col gap-5">{children}</div>
    </Card>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

interface DemoKey {
  id: string;
  store: string;
  company: string;
  validUntil: string;
  status: { tone: StatusTone; label: string };
  feeMinor: number;
}

const demoKeys: DemoKey[] = [
  {
    id: 'k1',
    store: 'Тестовая точка 1',
    company: 'Демо Фарм',
    validUntil: '2027-03-01',
    status: { tone: 'success', label: 'Активен' },
    feeMinor: 12000,
  },
  {
    id: 'k2',
    store: 'Тестовая точка 2',
    company: 'Демо Фарм',
    validUntil: '2026-10-07',
    status: { tone: 'warning', label: 'Истекает через 7 дней' },
    feeMinor: 12000,
  },
  {
    id: 'k3',
    store: 'Тестовая точка 3',
    company: 'Пример Мед',
    validUntil: '2026-09-01',
    status: { tone: 'danger', label: 'Отозван' },
    feeMinor: 0,
  },
  {
    id: 'k4',
    store: 'Тестовая точка 4',
    company: 'Пример Мед',
    validUntil: '2026-12-15',
    status: { tone: 'success', label: 'Активен' },
    feeMinor: 24050,
  },
];

type KeyColumn = 'store' | 'company' | 'validUntil' | 'status' | 'fee';

const keyColumns: DataTableColumn<DemoKey, KeyColumn>[] = [
  { key: 'store', header: 'Точка', cell: (row) => row.store, sortable: true },
  {
    key: 'company',
    header: 'Компания',
    cell: (row) => row.company,
    sortable: true,
  },
  {
    key: 'validUntil',
    header: 'Действует до',
    cell: (row) => row.validUntil.split('-').reverse().join('.'),
    sortable: true,
    nowrap: true,
  },
  {
    key: 'status',
    header: 'Статус',
    cell: (row) => (
      <StatusPill tone={row.status.tone}>{row.status.label}</StatusPill>
    ),
    nowrap: true,
  },
  {
    key: 'fee',
    header: 'Тариф, с',
    cell: (row) => formatMoney(row.feeMinor, { withSign: false }),
    numeric: true,
  },
];

function CatalogContent() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [chip, setChip] = useState<'all' | 'expiring' | 'revoked'>('all');
  const [tab, setTab] = useState<'stores' | 'billing' | 'audit'>('stores');
  const [locale, setLocale] = useState<'ru' | 'tg'>('ru');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [mode, setMode] = useState<'cloud' | 'offline'>('cloud');
  const [twoFactor, setTwoFactor] = useState(true);
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState<KeyColumn>>({
    key: 'store',
    direction: 'asc',
  });

  const sortedKeys = useMemo(() => {
    const value = (row: DemoKey) =>
      sort.key === 'company'
        ? row.company
        : sort.key === 'validUntil'
          ? row.validUntil
          : row.store;
    const sorted = [...demoKeys].sort((a, b) =>
      value(a).localeCompare(value(b), 'ru'),
    );
    return sort.direction === 'asc' ? sorted : sorted.reverse();
  }, [sort]);

  const chart = Array.from({ length: 14 }, (_, i) => {
    const valueMinor =
      [
        820, 910, 760, 1030, 990, 640, 580, 870, 960, 1110, 1040, 720, 690,
        1180,
      ][i] * 1000;
    return {
      key: `d${i}`,
      label: `${String(8 + i).padStart(2, '0')}.09`,
      value: valueMinor,
      valueText: formatMoney(valueMinor),
    };
  });

  return (
    <main className="mx-auto flex max-w-(--ph-size-content-max) flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">UI-кит libs/ui</h1>
        <p className="text-sm text-fg-subtle">
          Каталог компонентов (только dev). Данные синтетические.
        </p>
      </header>

      <Section title="Buttons">
        <Row>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="success">Success</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
        </Row>
        <Row>
          <Button iconStart="plus">Создать компанию</Button>
          <Button variant="secondary" iconStart="download">
            Выгрузить в Excel
          </Button>
          <Button variant="tertiary" iconEnd="chevron-right">
            Все компании
          </Button>
          <Button size="lg">Войти (size lg)</Button>
        </Row>
        <Row>
          <IconButton
            icon="bell"
            label="Уведомления, есть новые"
            indicator
            variant="surface"
          />
          <IconButton icon="x" label="Закрыть" variant="subtle" />
          <IconButton icon="refresh-cw" label="Обновить" />
          <IconButton icon="settings" label="Настройки" disabled />
        </Row>
      </Section>

      <Section title="Fields">
        <div className="grid grid-cols-2 gap-5">
          <TextField
            label="Название сети"
            placeholder="Например, Демо Фарм"
            required
            requiredText="обязательно"
          />
          <TextField
            label="Рабочая почта"
            type="email"
            defaultValue="operator@example.test"
            hint="Используется как логин"
          />
          <TextField
            label="ИНН"
            defaultValue="12345"
            error="ИНН — 9 цифр"
            inputMode="numeric"
          />
          <TextField
            label="Ключ"
            defaultValue="DEMO-0000-TEST-2026"
            mono
            readOnly
            hint="Только чтение"
          />
          <TextField
            label="Пароль"
            type="password"
            defaultValue="example"
            endAdornment={
              <IconButton icon="eye" label="Показать пароль" iconSize="sm" />
            }
          />
          <Select
            label="Расписание синхронизации"
            defaultValue="daily"
            options={[
              { value: 'daily', label: 'Раз в сутки, 03:00' },
              { value: 'twice', label: 'Дважды в сутки' },
              { value: 'hourly', label: 'Каждый час' },
              { value: 'manual', label: 'Только вручную' },
            ]}
          />
          <TextareaField
            label="Описание для владельца"
            hint="Видно в каталоге клиентского продукта"
          />
          <TextField label="Недоступно" disabled defaultValue="Вне MVP" />
        </div>
        <OtpField
          label="Код из письма"
          cellLabel={(i) => `Цифра ${i}`}
          value={code}
          onValueChange={setCode}
          hint="Код действует 10 минут"
        />
      </Section>

      <Section title="Choices">
        <RadioCardGroup
          label="Режим первой точки"
          value={mode}
          onValueChange={setMode}
          options={[
            {
              value: 'cloud',
              title: 'Облачная точка',
              description: 'Помесячная оплата',
              icon: 'store',
            },
            {
              value: 'offline',
              title: 'Автономная (офлайн)',
              description: 'Лицензионный ключ, Docker',
              icon: 'key-round',
            },
          ]}
        />
        <div className="grid grid-cols-2 gap-5">
          <Switch
            label="Подтверждение входа по коду"
            description="Код на почту; SMS вне MVP"
            checked={twoFactor}
            onCheckedChange={setTwoFactor}
          />
          <Switch
            label="Автоматическая доставка ключей"
            description="Вне MVP"
            checked={false}
            onCheckedChange={() => undefined}
            disabled
          />
          <Checkbox
            label="Тарифицировать неполный месяц пропорционально"
            defaultChecked
          />
          <Checkbox label="Недоступный вариант" disabled />
        </div>
      </Section>

      <Section title="Status and display">
        <Row>
          <StatusPill tone="success">Активна</StatusPill>
          <StatusPill tone="warning">Ключ истекает</StatusPill>
          <StatusPill tone="danger">Не оплачено</StatusPill>
          <StatusPill tone="info">Запланировано</StatusPill>
          <StatusPill tone="attention">Оператор платформы</StatusPill>
          <StatusPill tone="neutral">Офлайн</StatusPill>
          <CountBadge count={4} label="4 новых уведомления" />
          <CountBadge count={12} tone="neutral" />
        </Row>
        <Row>
          <Avatar name="Демо Фарм" size="sm" />
          <Avatar name="Тест Оператор" />
          <Avatar name="Пример Мед" size="lg" label="Пример Мед" />
        </Row>
        <div className="grid grid-cols-4 gap-4">
          <KpiTile
            label="Компаний"
            value="3"
            hint="все активны"
            icon="building-2"
          />
          <KpiTile
            label="Оплачено"
            value={formatMoney(200000)}
            hint="2 счёта из 3"
            tone="success"
            icon="receipt"
          />
          <KpiTile
            label="Требуют обновления"
            value="3"
            hint="из 5 установок"
            tone="warning"
            icon="package"
          />
          <KpiTile
            label="Просрочено"
            value={formatMoney(41400)}
            hint="1 компания"
            tone="danger"
            icon="triangle-alert"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Alert tone="info" title="Подсказка">
            Активной считается точка хотя бы с одной продажей в месяце.
          </Alert>
          <Alert tone="attention">
            Ответственность за локальные данные офлайн-точки несёт компания.
          </Alert>
          <Alert tone="warning">Оплаченный счёт пересчитать нельзя.</Alert>
          <Alert tone="danger">Неверная почта или пароль</Alert>
        </div>
        <Stepper
          label="Шаги создания компании"
          steps={[
            { label: 'Компания и владелец' },
            { label: 'Первая точка' },
            { label: 'Биллинг' },
          ]}
          current={step}
          completedText="выполнен"
          onStepSelect={setStep}
        />
        <Row>
          <Button
            variant="secondary"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Назад
          </Button>
          <Button onClick={() => setStep((s) => Math.min(2, s + 1))}>
            Далее
          </Button>
        </Row>
      </Section>

      <Section title="Navigation">
        <Row>
          <SegmentedControl
            label="Язык интерфейса"
            value={locale}
            onValueChange={setLocale}
            options={[
              { value: 'ru', label: 'RU', ariaLabel: 'Русский' },
              { value: 'tg', label: 'TJ', ariaLabel: 'Тоҷикӣ' },
            ]}
          />
          <SegmentedControl
            label="Вид списка"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'table', label: 'Таблица' },
              { value: 'cards', label: 'Карточки' },
            ]}
          />
        </Row>
        <ChipGroup label="Фильтр ключей">
          <Chip
            selected={chip === 'all'}
            count={4}
            onClick={() => setChip('all')}
          >
            Все
          </Chip>
          <Chip
            selected={chip === 'expiring'}
            count={1}
            onClick={() => setChip('expiring')}
          >
            Истекают
          </Chip>
          <Chip
            selected={chip === 'revoked'}
            count={1}
            onClick={() => setChip('revoked')}
          >
            Отозванные
          </Chip>
        </ChipGroup>
        <Tabs
          label="Разделы компании"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: 'stores',
              label: 'Точки',
              count: 4,
              panel: <p className="text-sm">Панель «Точки»</p>,
            },
            {
              value: 'billing',
              label: 'Счета и платежи',
              panel: <p className="text-sm">Панель «Счета»</p>,
            },
            {
              value: 'audit',
              label: 'Аудит',
              panel: <p className="text-sm">Панель «Аудит»</p>,
            },
          ]}
        />
      </Section>

      <Section title="Overlays">
        <Row>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Диалог с формой
          </Button>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Подтверждение
          </Button>
          <Button
            variant="tertiary"
            onClick={() => toast.show('Настройки платформы сохранены')}
          >
            Показать toast
          </Button>
          <Popover
            label="Уведомления"
            trigger={(props) => (
              <IconButton
                icon="bell"
                label="Уведомления"
                variant="surface"
                indicator
                {...props}
              />
            )}
          >
            {(close) => (
              <div className="flex flex-col">
                <p className="border-b border-border px-4 py-3 text-sm font-bold">
                  Уведомления
                </p>
                {[
                  'Просрочена оплата',
                  'Ключ истекает через 7 дней',
                  'Новый запрос услуги',
                ].map((text) => (
                  <p
                    key={text}
                    className="border-b border-border px-4 py-3 text-sm"
                  >
                    {text}
                  </p>
                ))}
                <div className="p-2">
                  <Button variant="tertiary" block onClick={close}>
                    Закрыть
                  </Button>
                </div>
              </div>
            )}
          </Popover>
        </Row>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Зафиксировать платёж"
          description="Дата «оплачено до» применится ко всем облачным точкам компании"
          closeLabel="Закрыть"
          size="md"
          footer={
            <>
              <Button variant="tertiary" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button
                onClick={() => {
                  setDialogOpen(false);
                  toast.show('Платёж зафиксирован');
                }}
              >
                Сохранить
              </Button>
            </>
          }
        >
          <TextField
            label="Сумма, с"
            inputMode="decimal"
            defaultValue="1 440,00"
          />
          <TextField label="Дата платежа" placeholder="дд.мм.гггг" />
        </Dialog>
        <Dialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Отозвать ключ?"
          description="Точка перестанет синхронизироваться при следующем обмене."
          closeLabel="Закрыть"
          icon="triangle-alert"
          tone="danger"
          footer={
            <>
              <Button variant="tertiary" onClick={() => setConfirmOpen(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirmOpen(false)}
              >
                Отозвать ключ
              </Button>
            </>
          }
        >
          <TextareaField label="Причина" rows={2} />
        </Dialog>
      </Section>

      <Section title="Data">
        <DataTable
          caption="Лицензионные ключи"
          columns={keyColumns}
          rows={sortedKeys.slice(offset, offset + 3)}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
          sortLabel={(d) =>
            d === 'asc'
              ? 'по возрастанию'
              : d === 'desc'
                ? 'по убыванию'
                : 'не сортируется'
          }
        />
        <Pagination
          offset={offset}
          limit={3}
          total={demoKeys.length}
          onOffsetChange={setOffset}
          labels={{
            nav: 'Страницы ключей',
            previous: 'Предыдущая страница',
            next: 'Следующая страница',
            range: ({ from, to, total }) => `${from}–${to} из ${total}`,
          }}
        />
        <DataTable
          caption="Пустая таблица"
          columns={keyColumns}
          rows={[]}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="Ключей в этом фильтре нет"
              description="Измените фильтр"
              action={<Button variant="tertiary">Показать все</Button>}
            />
          }
        />
        <BarChart
          caption="Продажи компаний за 14 дней"
          columnLabels={{ label: 'День', value: 'Продажи' }}
          items={chart}
        />
      </Section>

      <Section title="Icons">
        <ul className="m-0 grid list-none grid-cols-6 gap-3 p-0">
          {(Object.keys(icons) as IconName[]).map((name) => (
            <li
              key={name}
              className="flex items-center gap-2 text-xs text-fg-muted"
            >
              <Icon name={name} size="md" />
              <span className="truncate font-mono">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <p className="text-2xs">2xs — Ғ ғ Қ қ Ҳ ҳ Ҷ ҷ Ӣ ӣ Ӯ ӯ — 0123456789</p>
        <p className="text-sm">
          sm — Таблицы и формы админки. Ғ ғ Қ қ Ҳ ҳ Ҷ ҷ Ӣ ӣ Ӯ ӯ
        </p>
        <p className="text-md font-medium">
          md medium — Основной текст. Ғ ғ Қ қ Ҳ ҳ Ҷ ҷ Ӣ ӣ Ӯ ӯ
        </p>
        <p className="text-xl font-bold">
          xl bold — Заголовок страницы. Ғ ғ Қ қ Ҳ ҳ Ҷ ҷ Ӣ ӣ Ӯ ӯ
        </p>
        <p className="text-2xl font-bold tabular-nums">{formatMoney(333730)}</p>
      </Section>
    </main>
  );
}

export function UiKitCatalog() {
  return (
    <ToastProvider>
      <CatalogContent />
    </ToastProvider>
  );
}
