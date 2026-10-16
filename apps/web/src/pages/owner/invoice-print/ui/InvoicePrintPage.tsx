'use client';

import {
  Button,
  Card,
  EmptyState,
  Icon,
  InvoiceSheet,
  invoiceSheetOf,
  printDocument,
  SheetPrint,
  Spinner,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

function InvoicePrintView() {
  const t = useTranslations('invoicePrint');
  const id = useSearchParams()?.get('id') ?? '';
  const invoice = useQuery({
    queryKey: ['billing', 'invoice', id],
    queryFn: ({ signal }) =>
      apiRequest('billing.invoice', { params: { id }, signal }),
    enabled: id !== '',
  });
  const heading = invoice.data
    ? t('heading', { number: invoice.data.number })
    : null;
  // Chrome names a PDF saved from the print dialog after the page title; the root layout has one
  // static title, which comes back when the page is left
  useEffect(() => {
    if (heading === null) return;
    const before = document.title;
    document.title = heading;
    return () => {
      document.title = before;
    };
  }, [heading]);
  // the paper gets what the screen shows: nothing to print while it shows an error
  const sheet =
    invoice.data && !invoice.isError
      ? invoiceSheetOf(invoice.data, (key, values) => t(key, values))
      : null;
  return (
    <>
      <PageHeader
        title={heading ?? t('pageTitle')}
        actions={
          <Button
            iconStart="printer"
            disabled={sheet === null}
            onClick={() => void printDocument()}
          >
            {t('print')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <Link
          href={routes.storesBilling()}
          className="inline-flex min-h-touch items-center gap-1 self-start text-sm text-primary hover:text-primary-hover"
        >
          <Icon name="arrow-left" size="sm" />
          {t('back')}
        </Link>
        {id === '' ? (
          <EmptyState icon="file-text" title={t('notFound')} />
        ) : (
          <QueryState query={invoice}>
            {() =>
              sheet && (
                <Card
                  padding="none"
                  className="w-full max-w-(--ph-sheet-preview-width) p-(--ph-sheet-margin)"
                >
                  <InvoiceSheet {...sheet} headingLevel={2} />
                </Card>
              )
            }
          </QueryState>
        )}
        {sheet && (
          <SheetPrint>
            <InvoiceSheet {...sheet} />
          </SheetPrint>
        )}
      </div>
    </>
  );
}

/**
 * An invoice of the platform for print (spec 2026-10-15-billing-services, A5, section 9): the sheet
 * on screen and an A4 print root; `/stores/invoice?id=` — static export, no dynamic route.
 */
export function InvoicePrintPage() {
  return (
    <WithMessages groups={['owner']}>
      <Suspense
        fallback={
          <div className="grid min-h-dvh place-items-center text-primary">
            <Spinner size="xl" />
          </div>
        }
      >
        <InvoicePrintView />
      </Suspense>
    </WithMessages>
  );
}
