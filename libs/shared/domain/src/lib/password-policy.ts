/*
 * Password policy of the project (ADR-0008): at least 8 characters with an upper-case letter and a
 * digit; the upper bound protects the server from an expensive hash of a huge input.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRule = 'length' | 'upper' | 'digit';

const tests: Record<PasswordRule, (value: string) => boolean> = {
  length: (value) =>
    value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH,
  upper: (value) => /\p{Lu}/u.test(value),
  digit: (value) => /\d/.test(value),
};

export const passwordRules = Object.keys(tests) as PasswordRule[];

/** Rules the password breaks, in the order of the checklist. */
export function passwordProblems(value: string): PasswordRule[] {
  return passwordRules.filter((rule) => !tests[rule](value));
}
