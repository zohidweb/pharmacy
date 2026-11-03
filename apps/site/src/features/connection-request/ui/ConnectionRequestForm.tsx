'use client';

/*
 * The connection request form (spec 6.4, 7.3), the only client-heavy part of the site. Its own IntlProvider carries
 * only `connect` and `apiErrors`, so the bundle holds no other texts. Protection: the trap field (`hp_note` in the
 * DOM, `website` in the body) and the time the form was opened (`openedAt`, set on mount, not during the server
 * render). One request at a time: the button is busy while it is sent and a second submit is ignored (Review Focus 3).
 * Nothing typed is cleared on any error; an edit hides the failure alert.
 * Look (amendment 2026-11-02-public-site-light-panels 4.5): the form and the «Заявка принята» screen lie on the
 * surface of the light page, with a line border; the screen rises in by the CSS entrance (no `motion` on this page; at
 * once with reduce).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import type { UiLocale } from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Checkbox,
  Icon,
  TextareaField,
  TextField,
} from '@pharmacy/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { IntlProvider, useTranslations } from 'use-intl';
import type { Messages } from '@/shared/i18n';
import { localePath } from '@/shared/lib';
import { submitConnectionRequest, type SubmitResult } from '../api/submit';
import {
  connectionRequestSchema,
  EMPTY_CONNECTION_REQUEST,
  FIELD_MAX_LENGTH,
  isConnectionRequestErrorKey,
  isConnectionRequestField,
  toSubmitBody,
  type ConnectionRequestField,
  type ConnectionRequestInput,
  type ConnectionRequestValues,
} from '../model/schema';

type Failure = Extract<SubmitResult, { ok: false }>;

export interface ConnectionRequestFormProps {
  locale: UiLocale;
  /** Only the groups the form needs: the page passes them from the server dictionary. */
  messages: Pick<Messages, 'connect' | 'apiErrors'>;
  /** Working hours from the site settings in the page's language; empty: not shown. */
  workingHours: string;
}

/** Form order: the first field the API refused gets the focus. */
const FIELD_ORDER = Object.keys(
  EMPTY_CONNECTION_REQUEST,
) as ConnectionRequestField[];

/** The field codes of a 400 with their own text; any other code is «Проверьте поле». */
const SERVER_FIELD_CODES: Readonly<Record<string, 'phone' | 'email'>> = {
  phone_format: 'phone',
  email_format: 'email',
};

/**
 * The surface of the light page (mint-0) under the form and the done screen: a tile of 24 px with the line border of
 * the site (mint-150), so it reads on the page. The fields stay on this surface, none sits in a colour panel.
 */
const surfaceClass =
  'min-w-0 rounded-site-card border border-site-line bg-surface p-6 md:p-10';

function hasMaxLength(field: string): field is keyof typeof FIELD_MAX_LENGTH {
  return field in FIELD_MAX_LENGTH;
}

function RequestForm({
  locale,
  workingHours,
}: Omit<ConnectionRequestFormProps, 'messages'>) {
  const t = useTranslations('connect');
  const tApi = useTranslations('apiErrors');
  const schema = useMemo(() => connectionRequestSchema(), []);
  const form = useForm<
    ConnectionRequestInput,
    unknown,
    ConnectionRequestValues
  >({
    resolver: zodResolver(schema),
    // errors appear on submit, not on blur: an error shown on blur moves the consent checkbox from under the click
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: EMPTY_CONNECTION_REQUEST,
  });
  const { register, control, handleSubmit, setError, formState } = form;
  const comment = useWatch({ control, name: 'comment' });

  const openedAt = useRef<string | null>(null);
  useEffect(() => {
    openedAt.current = new Date().toISOString();
  }, []);

  // the ref, not the state: a second click before the re-render must not send a second request
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState(false);
  const doneTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done) doneTitle.current?.focus();
  }, [done]);

  const onValid = async (values: ConnectionRequestValues) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailure(null);
    try {
      const result = await submitConnectionRequest(
        toSubmitBody(
          values,
          locale,
          openedAt.current ?? new Date().toISOString(),
        ),
      );
      if (result.ok) {
        setDone(true);
        return;
      }
      if (result.status === 400) {
        const refused = FIELD_ORDER.filter((field) =>
          result.fields.some((error) => error.field === field),
        ).filter(isConnectionRequestField);
        refused.forEach((field, index) => {
          const code = result.fields.find(
            (error) => error.field === field,
          )?.code;
          setError(
            field,
            { message: (code && SERVER_FIELD_CODES[code]) ?? 'invalid' },
            { shouldFocus: index === 0 },
          );
        });
      }
      setFailure(result);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const errorOf = (field: ConnectionRequestField) => {
    const message = formState.errors[field]?.message;
    if (!isConnectionRequestErrorKey(message)) return undefined;
    if (message === 'tooLong' && hasMaxLength(field)) {
      return t('errors.tooLong', { max: FIELD_MAX_LENGTH[field] });
    }
    return t(`errors.${message}`);
  };

  const failureText = (problem: Failure): string => {
    if (problem.status === 0 || problem.status >= 500) return tApi('network');
    if (problem.status === 409 && problem.code === 'privacy_not_published') {
      return tApi('privacy_not_published');
    }
    if (problem.status === 429) {
      return problem.retryAfterSeconds === null
        ? tApi('too_many_requests_later')
        : tApi('too_many_requests', {
            minutes: Math.max(1, Math.ceil(problem.retryAfterSeconds / 60)),
          });
    }
    // a 400 that names none of the visitor's fields (openedAt, locale, …) has nothing to point at
    if (problem.status === 400) {
      return problem.fields.some((error) =>
        isConnectionRequestField(error.field),
      )
        ? tApi('validation_failed')
        : tApi('unexpected');
    }
    return tApi('unexpected');
  };

  if (done) {
    return (
      <section
        aria-labelledby="request-done"
        className={`site-enter flex flex-col items-start gap-4 ${surfaceClass}`}
      >
        <span className="text-success">
          <Icon name="circle-check" size="xl" />
        </span>
        <h2
          id="request-done"
          ref={doneTitle}
          tabIndex={-1}
          className="text-section text-balance outline-hidden"
        >
          {t('done.title')}
        </h2>
        <p className="text-lead">{t('done.text')}</p>
        {workingHours && (
          <p className="text-lead text-fg-muted">
            {t('done.hours', { hours: workingHours })}
          </p>
        )}
        <Link
          href={localePath(locale, '/')}
          className="inline-flex min-h-touch items-center font-semibold text-accent-site transition-colors hover:text-primary-hover hover:underline"
        >
          {t('done.home')}
        </Link>
      </section>
    );
  }

  const requiredText = t('required');
  return (
    <section aria-labelledby="request-form-title" className={surfaceClass}>
      <h2 id="request-form-title" className="ph-visually-hidden">
        {t('formTitle')}
      </h2>
      <form
        noValidate
        className="relative flex flex-col gap-5"
        onSubmit={handleSubmit(onValid)}
        // an edit answers the failure: the alert would otherwise describe a request that is no longer the one typed
        onChange={() => setFailure(null)}
      >
        <TextField
          label={t('fields.networkName')}
          required
          requiredText={requiredText}
          autoComplete="organization"
          error={errorOf('networkName')}
          {...register('networkName')}
        />
        <TextField
          label={t('fields.city')}
          required
          requiredText={requiredText}
          autoComplete="address-level2"
          error={errorOf('city')}
          {...register('city')}
        />
        <TextField
          label={t('fields.storeCount')}
          required
          requiredText={requiredText}
          inputMode="numeric"
          autoComplete="off"
          hint={t('fields.storeCountHint')}
          error={errorOf('storeCount')}
          {...register('storeCount')}
        />
        <TextField
          label={t('fields.contactName')}
          required
          requiredText={requiredText}
          autoComplete="name"
          error={errorOf('contactName')}
          {...register('contactName')}
        />
        <TextField
          label={t('fields.phone')}
          required
          requiredText={requiredText}
          type="tel"
          autoComplete="tel"
          placeholder="+992 00 000 00 00"
          hint={t('fields.phoneHint')}
          error={errorOf('phone')}
          {...register('phone')}
        />
        <TextField
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          error={errorOf('email')}
          {...register('email')}
        />
        <TextField
          label={t('fields.inn')}
          inputMode="numeric"
          autoComplete="off"
          placeholder="000000000"
          hint={t('fields.innHint')}
          error={errorOf('inn')}
          {...register('inn')}
        />
        <TextField
          label={t('fields.callTime')}
          hint={t('fields.callTimeHint')}
          error={errorOf('callTime')}
          {...register('callTime')}
        />
        <TextareaField
          label={t('fields.comment')}
          rows={4}
          hint={t('fields.commentCounter', {
            // the trimmed length, as the validation counts it
            count: comment.trim().length,
            max: FIELD_MAX_LENGTH.comment,
          })}
          error={errorOf('comment')}
          {...register('comment')}
        />
        <div className="flex flex-col gap-1">
          <Checkbox
            label={t.rich('consent', {
              link: (chunks) => (
                <a
                  href={localePath(locale, '/privacy')}
                  target="_blank"
                  rel="noopener"
                  // underlined: in a sentence a link must not differ by colour alone (emerald-700 to the 975 text
                  // is 2.7:1)
                  className="text-primary underline underline-offset-2 hover:text-primary-hover"
                >
                  {chunks}
                </a>
              ),
            })}
            aria-invalid={formState.errors.consent ? true : undefined}
            aria-describedby={
              formState.errors.consent ? 'consent-error' : undefined
            }
            {...register('consent')}
          />
          {formState.errors.consent && (
            <p
              id="consent-error"
              className="flex items-start gap-1 text-xs text-danger"
            >
              <Icon name="circle-alert" size="xs" className="mt-0.5" />
              <span>{errorOf('consent')}</span>
            </p>
          )}
        </div>

        {/* The trap (spec 7.3): out of sight and out of the tab order; a person never fills it. */}
        <div
          aria-hidden="true"
          style={{ position: 'absolute', left: '-10000px' }}
        >
          <input
            id="hp_note"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            {...register('hp_note')}
          />
        </div>

        {failure && (
          <Alert tone="danger" live="assertive">
            {failureText(failure)}
          </Alert>
        )}
        <div>
          <Button
            type="submit"
            size="lg"
            loading={sending || formState.isSubmitting}
          >
            {t('submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function ConnectionRequestForm({
  locale,
  messages,
  workingHours,
}: ConnectionRequestFormProps) {
  return (
    <IntlProvider locale={locale} messages={messages}>
      <RequestForm locale={locale} workingHours={workingHours} />
    </IntlProvider>
  );
}
