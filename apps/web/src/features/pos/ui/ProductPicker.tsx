'use client';

import type { PosCategory, PosProduct, SaleUnit } from '@pharmacy/shared-dto';
import { formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Chip,
  ChipGroup,
  cx,
  EmptyState,
  Icon,
  IconButton,
  TextField,
} from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import {
  PrescriptionBadge,
  sellablePieces,
  type CatalogIndex,
} from '@/entities/catalog';

export interface ProductPickerProps {
  index: CatalogIndex;
  categories: readonly PosCategory[];
  today: string;
  query: string;
  onQueryChange: (query: string) => void;
  categoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  onAdd: (product: PosProduct, unit: SaleUnit) => void;
  onDetails: (product: PosProduct) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}

const MAX_RESULTS = 24;

function stockText(
  product: PosProduct,
  today: string,
  t: ReturnType<typeof useTranslations<'pos'>>,
) {
  const pieces = sellablePieces(product, today);
  if (pieces === 0) return t('outOfStock');
  const packs = Math.floor(pieces / product.piecesPerPack);
  const rest = pieces % product.piecesPerPack;
  return rest > 0
    ? t('stockPacksPieces', { packs, pieces: rest })
    : t('stockPacks', { packs });
}

function ProductTile({
  product,
  today,
  onAdd,
  onDetails,
}: {
  product: PosProduct;
  today: string;
  onAdd: ProductPickerProps['onAdd'];
  onDetails: ProductPickerProps['onDetails'];
}) {
  const t = useTranslations('pos');
  const available = sellablePieces(product, today) > 0;
  return (
    <li className="flex min-h-touch-primary items-stretch gap-1 rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={() => onAdd(product, 'pack')}
        className={cx(
          'flex min-w-0 flex-1 flex-col items-start gap-1 rounded-s-md p-3 text-start transition-colors hover:bg-surface-sunken',
          !available && 'text-fg-subtle',
        )}
      >
        <span className="text-sm font-medium text-fg">{product.name}</span>
        <span className="text-xs text-fg-subtle">
          {product.inn ? `${product.inn} · ` : ''}
          {stockText(product, today, t)}
        </span>
        <span className="mt-auto flex flex-wrap items-center gap-2">
          <span className="text-md font-bold tabular-nums text-fg">
            {formatMoney(product.priceMinor)}
          </span>
          <PrescriptionBadge kind={product.prescription} />
        </span>
      </button>
      <span className="flex flex-col justify-between border-s border-border p-1">
        <IconButton
          icon="info"
          label={t('detailsOf', { name: product.name })}
          onClick={() => onDetails(product)}
        />
        {product.divisible && product.piecePriceMinor !== null && available && (
          <button
            type="button"
            aria-label={t('addPieceOf', {
              name: product.name,
              price: formatMoney(product.piecePriceMinor),
            })}
            onClick={() => onAdd(product, 'piece')}
            className="min-h-touch rounded-md px-2 text-2xs font-medium text-primary hover:bg-primary-subtle"
          >
            {t('perPiece')}
          </button>
        )}
      </span>
    </li>
  );
}

/** Search by name, МНН or barcode with category filter; out-of-stock products show analogs by МНН. */
export function ProductPicker({
  index,
  categories,
  today,
  query,
  onQueryChange,
  categoryId,
  onCategoryChange,
  onAdd,
  onDetails,
  searchRef,
}: ProductPickerProps) {
  const t = useTranslations('pos');
  // products in stock first; out-of-stock ones stay findable (their analogs are offered)
  const results = index
    .search(query, categoryId)
    .map((product) => ({ product, stock: sellablePieces(product, today) }))
    .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0))
    .map(({ product }) => product)
    .slice(0, MAX_RESULTS);
  const searching = query.trim() !== '';
  const missing = searching
    ? results.find(
        (product) => sellablePieces(product, today) === 0 && product.inn,
      )
    : undefined;
  const analogs = missing ? index.analogsOf(missing, today) : [];

  return (
    <section aria-label={t('catalog')} className="flex min-h-0 flex-col gap-3">
      <TextField
        ref={searchRef}
        label={t('search')}
        hideLabel
        placeholder={t('searchPlaceholder')}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <ChipGroup label={t('categories')}>
        <Chip
          selected={categoryId === null}
          onClick={() => onCategoryChange(null)}
        >
          {t('allCategories')}
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            selected={categoryId === category.id}
            onClick={() =>
              onCategoryChange(categoryId === category.id ? null : category.id)
            }
          >
            {category.name}
          </Chip>
        ))}
      </ChipGroup>
      {missing && (
        <Alert
          tone="warning"
          title={t('missingTitle', { name: missing.name })}
          live="polite"
        >
          {analogs.length > 0
            ? t('analogsHint', { inn: missing.inn ?? '' })
            : t('noAnalogs')}
        </Alert>
      )}
      {analogs.length > 0 && (
        <ul
          aria-label={t('analogs')}
          className="m-0 grid list-none grid-cols-2 gap-2 p-0"
        >
          {analogs.map((product) => (
            <ProductTile
              key={product.id}
              product={product}
              today={today}
              onAdd={onAdd}
              onDetails={onDetails}
            />
          ))}
        </ul>
      )}
      {results.length === 0 ? (
        <EmptyState icon="search" title={t('nothingFound')} />
      ) : (
        <ul
          aria-label={t('results')}
          className="m-0 grid min-h-0 flex-1 list-none auto-rows-max grid-cols-2 gap-2 overflow-y-auto p-0"
        >
          {results.map((product) => (
            <ProductTile
              key={product.id}
              product={product}
              today={today}
              onAdd={onAdd}
              onDetails={onDetails}
            />
          ))}
        </ul>
      )}
      <p className="flex items-center gap-2 text-xs text-fg-subtle">
        <Icon name="info" size="sm" />
        {t('scanHint')}
      </p>
    </section>
  );
}
