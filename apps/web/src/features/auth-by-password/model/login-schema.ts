import { z } from 'zod';

/** Error messages are i18n keys under `auth.errors` (ADR-0015: no English texts in schemas). */
export type LoginErrorKey = 'loginRequired' | 'passwordRequired';

const error = (key: LoginErrorKey) => ({ error: key });

/** Upper bound against DoS by an expensive hash (ADR-0008); the server enforces the same. */
const PASSWORD_MAX = 128;

export const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, error('loginRequired')),
  password: z
    .string()
    .min(1, error('passwordRequired'))
    .max(PASSWORD_MAX, error('passwordRequired')),
});

export type LoginFormValues = z.input<typeof loginSchema>;
export type LoginPayload = z.output<typeof loginSchema>;

export function isLoginErrorKey(value: unknown): value is LoginErrorKey {
  return value === 'loginRequired' || value === 'passwordRequired';
}
