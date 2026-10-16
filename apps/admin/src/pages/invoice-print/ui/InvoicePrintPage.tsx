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
import { billingKeys } from '@/entities/invoice';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

function InvoicePrintView() {
  const t = useTranslations('invoicePrint');
  const id = useSearchParams()?.get('id') ?? '';
  const invoice = useQuery({
    queryKey: billingKeys.invoice(id),
    queryFn: ({ signal }) =>
      apiRequest('invoices.get', { params: { id }, signal }),
    enabled: id !== '',
  });
  const heading = invoice.data
    ? t('heading', { number: invoice.data.number })
    : null;
  // Chrome names a PDF saved from the print dialog after the page title
  useEffect(() => {
    if (heading === null) return;
    const before = document.title;
    document.title = heading;
    return () => {
      document.title = before;
    };
  }, [heading]);
  // the last loaded invoice is what reaches the paper, even while a refetch fails
  const sheet = invoice.data
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
          href={routes.invoices()}
          className="inline-flex items-center gap-1 self-start text-sm text-primary hover:text-primary-hover"
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

/** «Счёт» for print: the sheet on screen and an A4 print root (ADR-0015: id in the query). */
export function InvoicePrintPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center text-primary">
          <Spinner size="xl" />
        </div>
      }
    >
      <InvoicePrintView />
    </Suspense>
  );
}
