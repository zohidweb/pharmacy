'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type {
  SiteMediaType,
  SiteSettings,
  UpdateSiteSettingsRequest,
} from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  TextareaField,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import {
  siteKeys,
  siteMediaContentUrl,
  useSiteSettings,
} from '@/entities/site-content';
import { SiteMediaPickerDialog } from '@/features/site-media';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { useScrollIntoViewOnError } from '@/shared/lib';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

// The limits and formats of the API (apps/api site-content, dto/site-settings.dto.ts).
const LIMITS = {
  name: 120,
  tagline: 200,
  seoDescription: 160,
  address: 300,
  workingHours: 200,
  email: 254,
  telegramUrl: 300,
  whatsappUrl: 300,
} as const;
const PHONE = /^(\+[0-9]{8,15})?$/;
const TELEGRAM = /^(https:\/\/t\.me\/\S+)?$/;
const WHATSAPP = /^(https:\/\/wa\.me\/\S+)?$/;

/** The logo and the favicon are small and sharp: PNG or WebP only (the API refuses a JPEG there too). */
const SHARP_TYPES: readonly SiteMediaType[] = ['image/png', 'image/webp'];

const text = (max: number) => z.string().trim().max(max, { error: 'tooLong' });
const pair = (max: number) => z.object({ ru: text(max), tg: text(max) });

const schema = z.object({
  name: pair(LIMITS.name),
  tagline: pair(LIMITS.tagline),
  seoDescription: pair(LIMITS.seoDescription),
  address: pair(LIMITS.address),
  workingHours: pair(LIMITS.workingHours),
  logoMediaId: z.string().nullable(),
  faviconMediaId: z.string().nullable(),
  ogImageMediaId: z.string().nullable(),
  phone: z.string().trim().regex(PHONE, { error: 'phone' }),
  email: z
    .string()
    .trim()
    .max(LIMITS.email, { error: 'tooLong' })
    .refine((value) => value === '' || z.email().safeParse(value).success, {
      error: 'email',
    }),
  telegramUrl: z
    .string()
    .trim()
    .max(LIMITS.telegramUrl, { error: 'tooLong' })
    .regex(TELEGRAM, { error: 'telegram' }),
  whatsappUrl: z
    .string()
    .trim()
    .max(LIMITS.whatsappUrl, { error: 'tooLong' })
    .regex(WHATSAPP, { error: 'whatsapp' }),
});
type Values = z.input<typeof schema>;
type TextKey =
  'name' | 'tagline' | 'seoDescription' | 'address' | 'workingHours';
type PlainKey = 'phone' | 'email' | 'telegramUrl' | 'whatsappUrl';
type ImageField = 'logoMediaId' | 'faviconMediaId' | 'ogImageMediaId';
type ErrorKey = 'tooLong' | 'phone' | 'email' | 'telegram' | 'whatsapp';
const errorKeys: readonly string[] = [
  'tooLong',
  'phone',
  'email',
  'telegram',
  'whatsapp',
];

const locales = ['ru', 'tg'] as const;
const localeTag = { ru: 'RU', tg: 'TJ' } as const;

const images: readonly {
  field: ImageField;
  /** `undefined` — any stored type. */
  accept?: readonly SiteMediaType[];
}[] = [
  { field: 'logoMediaId', accept: SHARP_TYPES },
  { field: 'faviconMediaId', accept: SHARP_TYPES },
  { field: 'ogImageMediaId' },
];

function toValues(settings: SiteSettings): Values {
  const { updatedAt: _updatedAt, ...values } = settings;
  return values;
}

/**
 * «Сайт → Настройки» (spec 2026-10-28-public-site-design, S9): the name, the contacts, the SEO defaults and the
 * pictures of the public site. Saving needs a recent sign-in (`fresh_auth_required`, shown in the form). The
 * picture dialog holds a form of its own, so it stands next to the page form, not inside it.
 */
export function SiteSettingsPage() {
  const t = useTranslations('siteSettings');
  const settings = useSiteSettings();
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={settings}>
          {(data) => <SettingsForm settings={data} />}
        </QueryState>
      </div>
    </>
  );
}

function SettingsForm({ settings }: { settings: SiteSettings }) {
  const t = useTranslations('siteSettings');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState<ImageField | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: toValues(settings),
    // A background refetch must not wipe what the operator is typing.
    resetOptions: { keepDirtyValues: true },
  });

  const save = useMutation({
    mutationFn: (values: Values): Promise<SiteSettings> => {
      // The schema trims every text; the API trims too, but an unchanged value must not look changed.
      const body: UpdateSiteSettingsRequest = schema.parse(values);
      return apiRequest('siteSettings.update', { body });
    },
    onSuccess: (saved, sent) => {
      queryClient.setQueryData<SiteSettings>(siteKeys.settings, saved);
      // Text typed while the request was in flight stays in the form (and shows as changed against `saved`).
      const now = schema.safeParse(form.getValues());
      const unchanged =
        now.success &&
        JSON.stringify(now.data) === JSON.stringify(schema.parse(sent));
      form.reset(
        toValues(saved),
        unchanged ? undefined : { keepDirtyValues: true },
      );
      toast.show(t('saved'));
    },
  });
  const apiError = useApiErrorMessage(save.error);
  // The error stands next to the button that caused it; the page may be scrolled to the cards above.
  const errorRef = useScrollIntoViewOnError(save.error);

  const messageOf = (message: string | undefined, max: number) =>
    message && errorKeys.includes(message)
      ? t(`errors.${message as ErrorKey}`, { max })
      : undefined;
  const plainError = (field: PlainKey) =>
    messageOf(
      form.formState.errors[field]?.message,
      field in LIMITS ? LIMITS[field as keyof typeof LIMITS] : 0,
    );

  const textPair = (field: TextKey, multiline = false) => (
    <div className="grid grid-cols-2 items-start gap-4">
      {locales.map((locale) => {
        const props = {
          label: `${t(`fields.${field}`)} · ${localeTag[locale]}`,
          hint: t('limit', { max: LIMITS[field] }),
          error: messageOf(
            form.formState.errors[field]?.[locale]?.message,
            LIMITS[field],
          ),
          ...form.register(`${field}.${locale}`),
        };
        return multiline ? (
          <TextareaField key={locale} rows={3} {...props} />
        ) : (
          <TextField key={locale} {...props} />
        );
      })}
    </div>
  );

  const picked = images.find((image) => image.field === picking);
  const setImage = (field: ImageField, id: string | null) =>
    form.setValue(field, id, { shouldDirty: true });

  return (
    <>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        className="flex flex-col gap-4"
      >
        <Card
          as="section"
          aria-labelledby="site-main"
          className="flex flex-col gap-4"
        >
          <CardHeader
            title={t('main.title')}
            titleId="site-main"
            description={t('main.description')}
          />
          {textPair('name')}
          {textPair('tagline')}
          {textPair('seoDescription', true)}
        </Card>

        <Card
          as="section"
          aria-labelledby="site-contacts"
          className="flex flex-col gap-4"
        >
          <CardHeader
            title={t('contacts.title')}
            titleId="site-contacts"
            description={t('contacts.description')}
          />
          {textPair('address')}
          {textPair('workingHours')}
          <div className="grid grid-cols-2 items-start gap-4">
            <TextField
              label={t('fields.phone')}
              hint={t('fields.phoneHint')}
              type="tel"
              inputMode="tel"
              error={plainError('phone')}
              {...form.register('phone')}
            />
            <TextField
              label={t('fields.email')}
              hint={t('fields.emailHint')}
              type="email"
              error={plainError('email')}
              {...form.register('email')}
            />
            <TextField
              label={t('fields.telegramUrl')}
              hint={t('fields.telegramUrlHint')}
              error={plainError('telegramUrl')}
              {...form.register('telegramUrl')}
            />
            <TextField
              label={t('fields.whatsappUrl')}
              hint={t('fields.whatsappUrlHint')}
              error={plainError('whatsappUrl')}
              {...form.register('whatsappUrl')}
            />
          </div>
        </Card>

        <Card
          as="section"
          aria-labelledby="site-images"
          className="flex flex-col gap-4"
        >
          <CardHeader
            title={t('images.title')}
            titleId="site-images"
            description={t('images.description')}
          />
          <div className="grid grid-cols-3 items-start gap-4">
            {images.map(({ field }) => {
              const id = form.watch(field);
              return (
                <div key={field} className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-fg">
                      {t(`images.${field}`)}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {t(`images.${field}Hint`)}
                    </span>
                  </div>
                  {id === null ? (
                    <p className="text-sm text-fg-subtle">{t('images.none')}</p>
                  ) : (
                    <img
                      src={siteMediaContentUrl(id)}
                      alt=""
                      className="max-h-32 w-full rounded-md border border-border bg-surface-sunken object-contain"
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      iconStart="image"
                      variant="secondary"
                      onClick={() => setPicking(field)}
                    >
                      {id === null ? t('images.choose') : t('images.change')}
                    </Button>
                    {id !== null && (
                      <Button
                        variant="tertiary"
                        onClick={() => setImage(field, null)}
                      >
                        {t('images.remove')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {apiError && (
          <div ref={errorRef}>
            <Alert tone="danger" live="assertive">
              {apiError}
            </Alert>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            iconStart="check"
            disabled={!form.formState.isDirty}
            loading={save.isPending}
          >
            {t('save')}
          </Button>
          <p className="text-xs text-fg-subtle">{t('saveHint')}</p>
        </div>
      </form>

      {/* Outside the <form>: the dialog holds a form of its own (a form in a form is invalid HTML). */}
      <SiteMediaPickerDialog
        open={picking !== null}
        accept={picked?.accept}
        onClose={() => setPicking(null)}
        onPick={(media) => {
          if (picking !== null) setImage(picking, media.id);
          setPicking(null);
        }}
      />
    </>
  );
}
