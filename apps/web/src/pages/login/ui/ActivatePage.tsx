'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  PASSWORD_MAX_LENGTH,
  passwordProblems,
  passwordRules,
} from '@pharmacy/shared-domain';
import { Alert, Button, Icon, TextField } from '@pharmacy/ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { LoginForm } from '@/features/auth-by-password';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { LoginCard } from './LoginCard';

type ActivateErrorKey = 'required' | 'passwordPolicy' | 'mismatch';

const error = (key: ActivateErrorKey) => ({ error: key });

const activateSchema = z
  .object({
    login: z.string().trim().toLowerCase().min(1, error('required')),
    code: z.string().trim().min(1, error('required')),
    newPassword: z
      .string()
      .max(PASSWORD_MAX_LENGTH, error('passwordPolicy'))
      .refine((value) => passwordProblems(value).length === 0, error('passwordPolicy')),
    repeat: z.string(),
  })
  .refine((values) => values.newPassword === values.repeat, {
    path: ['repeat'],
    error: 'mismatch',
  });

type ActivateValues = z.input<typeof activateSchema>;
type ActivatePayload = z.output<typeof activateSchema>;

const isErrorKey = (value: unknown): value is ActivateErrorKey =>
  value === 'required' || value === 'passwordPolicy' || value === 'mismatch';

/**
 * First sign-in by the one-time activation code (ADR-0008, amendment 2026-10-02): the owner sets
 * the password, then signs in on the same screen; the store step follows on the sign-in page.
 * The login does not travel in the URL.
 */
export function ActivatePage() {
  const t = useTranslations('auth.activate');
  const router = useRouter();
  const [activated, setActivated] = useState<string | null>(null);
  const form = useForm<ActivateValues, unknown, ActivatePayload>({
    resolver: zodResolver(activateSchema),
    defaultValues: { login: '', code: '', newPassword: '', repeat: '' },
  });
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = form;
  const password = useWatch({ control, name: 'newPassword' });
  const activate = useMutation({
    mutationFn: (values: ActivatePayload) =>
      apiRequest('activations.create', {
        body: {
          login: values.login,
          code: values.code,
          newPassword: values.newPassword,
        },
      }),
    onSuccess: (_, values) => setActivated(values.login),
  });
  const submitError = useApiErrorMessage(activate.error);
  const message = (value: string | undefined) =>
    isErrorKey(value) ? t(`errors.${value}`) : undefined;

  if (activated !== null) {
    return (
      <LoginCard title={t('doneTitle')} subtitle={t('doneSubtitle')}>
        <Alert tone="success">{t('done')}</Alert>
        <LoginForm
          defaultLogin={activated}
          onSuccess={() => router.replace(routes.login())}
        />
      </LoginCard>
    );
  }

  return (
    <LoginCard title={t('title')} subtitle={t('subtitle')}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={handleSubmit((values) => activate.mutate(values))}
      >
        <TextField
          label={t('login')}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          error={message(errors.login?.message)}
          {...register('login')}
        />
        <TextField
          label={t('code')}
          hint={t('codeHint')}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          error={message(errors.code?.message)}
          {...register('code')}
        />
        <TextField
          label={t('newPassword')}
          type="password"
          autoComplete="new-password"
          required
          error={message(errors.newPassword?.message)}
          {...register('newPassword')}
        />
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0 text-sm"
          aria-label={t('rulesLabel')}
        >
          {passwordRules.map((rule) => {
            const ok = !passwordProblems(password ?? '').includes(rule);
            return (
              <li
                key={rule}
                className={
                  ok
                    ? 'flex items-center gap-2 text-success'
                    : 'flex items-center gap-2 text-fg-muted'
                }
              >
                <Icon name={ok ? 'circle-check' : 'circle-alert'} size="sm" />
                {t(`rules.${rule}`)}
                <span className="ph-visually-hidden">
                  , {ok ? t('ruleMet') : t('ruleNotMet')}
                </span>
              </li>
            );
          })}
        </ul>
        <TextField
          label={t('repeat')}
          type="password"
          autoComplete="new-password"
          required
          error={message(errors.repeat?.message)}
          {...register('repeat')}
        />
        {submitError && (
          <Alert tone="danger" live="assertive">
            {submitError}
          </Alert>
        )}
        <Button type="submit" size="lg" block loading={activate.isPending}>
          {t('submit')}
        </Button>
        <Link
          href={routes.login()}
          className="self-start text-sm text-primary hover:text-primary-hover"
        >
          {t('backToLogin')}
        </Link>
      </form>
    </LoginCard>
  );
}
