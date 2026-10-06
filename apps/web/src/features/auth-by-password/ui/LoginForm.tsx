'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import { Alert, Button, IconButton, TextField } from '@pharmacy/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { ApiError } from '@/shared/api';
import { useLogin } from '../api/login';
import {
  isLoginErrorKey,
  loginSchema,
  type LoginFormValues,
  type LoginPayload,
} from '../model/login-schema';

export interface LoginFormProps {
  onSuccess: (session: EmployeeSession) => void;
  /** Prefilled login (right after the first sign-in by an activation code). */
  defaultLogin?: string;
}

/**
 * Employee sign-in by login and password (ADR-0008). Field errors come from zod (i18n keys); a
 * wrong pair is one message that does not tell which field was wrong (401 invalid_credentials).
 */
export function LoginForm({ onSuccess, defaultLogin = '' }: LoginFormProps) {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues, unknown, LoginPayload>({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: defaultLogin, password: '' },
  });

  const fieldError = (message: string | undefined) =>
    isLoginErrorKey(message) ? t(`errors.${message}`) : undefined;

  const submitError = (() => {
    const error = login.error;
    if (!error) return null;
    if (error instanceof ApiError && error.status === 401) {
      return t('invalidCredentials');
    }
    if (
      error instanceof ApiError &&
      (error.code === 'network' || error.code === 'timeout')
    ) {
      return tErrors('network');
    }
    return tErrors('unexpected', {
      correlationId: error instanceof ApiError ? error.correlationId : '—',
    });
  })();

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={handleSubmit((values) => login.mutate(values, { onSuccess }))}
    >
      <TextField
        label={t('login')}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={defaultLogin === ''}
        required
        error={fieldError(errors.login?.message)}
        {...register('login')}
      />
      <TextField
        label={t('password')}
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        required
        error={fieldError(errors.password?.message)}
        endAdornment={
          <IconButton
            icon={showPassword ? 'eye-off' : 'eye'}
            label={showPassword ? t('hidePassword') : t('showPassword')}
            iconSize="sm"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          />
        }
        {...register('password')}
      />
      {submitError && (
        <Alert tone="danger" live="assertive">
          {submitError}
        </Alert>
      )}
      <Button type="submit" size="lg" block loading={login.isPending}>
        {t('submit')}
      </Button>
    </form>
  );
}
