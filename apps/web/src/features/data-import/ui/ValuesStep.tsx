'use client';

import { Button, Card, CardHeader, Select } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import type { CatalogValueChoices } from '../model/catalog-values';

export interface ValuesStepProps {
  choices: CatalogValueChoices;
  categories: readonly string[];
  forms: readonly string[];
  canCreateCategories: boolean;
  onChoices: (choices: CatalogValueChoices) => void;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Step 3 of the catalog (F6): a category of the file the network does not have is created or replaced by one of its
 * categories; a form of the file outside the dosage forms of the network becomes one of them or none — forms are not
 * created. Rows without a category take the category by default.
 */
export function ValuesStep(props: ValuesStepProps) {
  const t = useTranslations('dataImport.values');
  const tCommon = useTranslations('dataImport');
  const { choices } = props;
  const set = (patch: Partial<CatalogValueChoices>) =>
    props.onChoices({ ...choices, ...patch });
  const categoryOptions = props.categories.map((name) => ({
    value: name,
    label: name,
  }));
  const valid =
    choices.unknownCategories.every(
      (item) => (choices.categories[item.key] ?? '') !== '',
    ) &&
    (choices.emptyCategories === 0 || choices.defaultCategory !== '');

  return (
    <Card padding="none">
      <CardHeader title={t('title')} description={t('hint')} />
      <div className="flex flex-col gap-6 p-(--ph-card-padding)">
        {choices.unknownCategories.length > 0 && (
          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">{t('categories')}</h3>
            <p className="text-sm text-fg-muted">
              {props.canCreateCategories
                ? t('categoriesHint')
                : t('categoriesNoCreate')}
            </p>
            <div className="grid grid-cols-2 items-start gap-4">
              {choices.unknownCategories.map((item) => (
                <Select
                  key={item.key}
                  label={t('fileValue', { value: item.text, rows: item.rows })}
                  required
                  value={choices.categories[item.key] ?? ''}
                  placeholder={t('chooseCategory')}
                  options={[
                    ...(props.canCreateCategories
                      ? [
                          {
                            value: item.text,
                            label: t('create', { name: item.text }),
                          },
                        ]
                      : []),
                    ...categoryOptions,
                  ]}
                  onChange={(event) =>
                    set({
                      categories: {
                        ...choices.categories,
                        [item.key]: event.target.value,
                      },
                    })
                  }
                />
              ))}
            </div>
          </section>
        )}
        {choices.emptyCategories > 0 && (
          <Select
            label={t('defaultCategory', { rows: choices.emptyCategories })}
            required
            value={choices.defaultCategory}
            placeholder={t('chooseCategory')}
            options={categoryOptions}
            onChange={(event) => set({ defaultCategory: event.target.value })}
          />
        )}
        {choices.unknownForms.length > 0 && (
          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">{t('forms')}</h3>
            <p className="text-sm text-fg-muted">{t('formsHint')}</p>
            <div className="grid grid-cols-2 items-start gap-4">
              {choices.unknownForms.map((item) => (
                <Select
                  key={item.key}
                  label={t('fileValue', { value: item.text, rows: item.rows })}
                  value={choices.forms[item.key] ?? ''}
                  options={[
                    { value: '', label: t('noForm') },
                    ...props.forms.map((form) => ({
                      value: form,
                      label: form,
                    })),
                  ]}
                  onChange={(event) =>
                    set({
                      forms: {
                        ...choices.forms,
                        [item.key]: event.target.value,
                      },
                    })
                  }
                />
              ))}
            </div>
          </section>
        )}
        <div className="flex justify-between">
          <Button variant="secondary" onClick={props.onBack}>
            {tCommon('back')}
          </Button>
          <Button disabled={!valid} onClick={props.onNext}>
            {tCommon('next')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
