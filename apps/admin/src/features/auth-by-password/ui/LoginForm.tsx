'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
} from '../model/login-schema';

export interface LoginFormProps {
  onSuccess: () => void;
}

/**
 * Operator login by work e-mail and password (ADR-0008). Field errors come from zod (i18n keys),
 * a wrong pair is reported by the server (401 invalid_credentials) as one message without
 * telling which field was wrong. Focus moves to the first invalid field on submit (RHF default).
 */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: '', password: '' },
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
      onSubmit={handleSubmit((values) =>
        login.mutate(loginSchema.parse(values), { onSuccess }),
      )}
    >
      {submitError && (
        <Alert tone="danger" live="assertive">
          {submitError}
        </Alert>
      )}
      <TextField
        label={t('login')}
        hint={t('loginHint')}
        type="email"
        autoComplete="username"
        autoFocus
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
      <Button type="submit" size="lg" block loading={login.isPending}>
        {t('submit')}
      </Button>
    </form>
  );
}
