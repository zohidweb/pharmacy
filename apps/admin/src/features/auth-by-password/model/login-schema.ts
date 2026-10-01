import { z } from 'zod';

/** Error messages are i18n keys under `auth.errors` (ADR-0015: no English texts in schemas). */
export type LoginErrorKey =
  'loginRequired' | 'loginFormat' | 'passwordRequired';

const error = (key: LoginErrorKey) => ({ error: key });

export const loginSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1, error('loginRequired'))
    .pipe(z.email(error('loginFormat'))),
  password: z.string().min(1, error('passwordRequired')),
});

export type LoginFormValues = z.input<typeof loginSchema>;
export type LoginPayload = z.output<typeof loginSchema>;

export function isLoginErrorKey(value: unknown): value is LoginErrorKey {
  return (
    value === 'loginRequired' ||
    value === 'loginFormat' ||
    value === 'passwordRequired'
  );
}
