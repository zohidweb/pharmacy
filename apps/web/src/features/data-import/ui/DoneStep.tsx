'use client';

import { Alert, Button, Card, CardHeader } from '@pharmacy/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { type ImportResult, kindPages } from '../model/kinds';

export interface DoneStepProps {
  result: ImportResult;
  onAgain: () => void;
}

/** Step «Done» (spec 2026-10-20-data-import, section 9): what was written; drafts of opening balances wait to be posted. */
export function DoneStep({ result, onAgain }: DoneStepProps) {
  const t = useTranslations('dataImport');
  const router = useRouter();
  return (
    <Card padding="none">
      <CardHeader inset title={t('done.title')} />
      <div className="flex flex-col gap-4 px-(--ph-card-padding) pb-(--ph-card-padding)">
        <Alert tone="success" live="polite">
          {result.kind === 'catalog'
            ? t('done.catalog', {
                created: result.result.created,
                existing: result.result.existing,
                categoriesCreated: result.result.categoriesCreated,
              })
            : result.kind === 'suppliers'
              ? t('done.suppliers', {
                  created: result.result.created,
                  existing: result.result.existing,
                })
              : t('done.balances', { count: result.result.documents.length })}
        </Alert>
        {result.kind === 'opening-balances' && (
          <ul className="flex flex-col gap-1">
            {result.result.documents.map((doc) => (
              <li key={doc.id}>
                {t('done.document', { number: doc.number, lines: doc.lines })}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between">
          <Button variant="secondary" onClick={onAgain}>
            {t('done.again')}
          </Button>
          <Button onClick={() => router.push(kindPages[result.kind])}>
            {t(`kinds.${result.kind}.open`)}
          </Button>
        </div>
      </div>
    </Card>
  );
}
