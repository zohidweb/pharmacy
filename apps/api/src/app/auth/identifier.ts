// Login identifier normalization (auth design 2026-10-02, section 6, step 2). The resolver
// resolve_login compares the value as given with lower(login), lower(email) and the E.164 phone,
// so login and e-mail are lower-cased here and the phone is brought to E.164.

export type IdentifierKind = 'login' | 'phone' | 'email';

export interface NormalizedIdentifier {
  kind: IdentifierKind;
  value: string;
}

const MAX_LOGIN_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
// Tajikistan: national significant numbers have 9 digits, the country code is 992.
const COUNTRY_CODE = '992';
const NATIONAL_DIGITS = 9;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPED = /^[+\d\s\-()]+$/;
const PHONE_SEPARATORS = /[\s\-()]/g;
const DIGITS = /^\d+$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const WHITESPACE = /\s/;

function normalizePhone(raw: string): string | null {
  const compact = raw.replace(PHONE_SEPARATORS, '');
  let candidate: string | null = null;
  if (compact.startsWith('+')) {
    candidate = compact;
  } else if (DIGITS.test(compact)) {
    if (compact.length === NATIONAL_DIGITS) {
      candidate = `+${COUNTRY_CODE}${compact}`;
    } else if (
      compact.length === COUNTRY_CODE.length + NATIONAL_DIGITS &&
      compact.startsWith(COUNTRY_CODE)
    ) {
      candidate = `+${compact}`;
    }
  }
  return candidate !== null && E164.test(candidate) ? candidate : null;
}

/** The kind and normalized value of a login identifier, or null when it cannot be one. */
export function normalizeIdentifier(raw: string): NormalizedIdentifier | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email)
      ? { kind: 'email', value: email }
      : null;
  }

  if (PHONE_SHAPED.test(trimmed)) {
    const phone = normalizePhone(trimmed);
    return phone === null ? null : { kind: 'phone', value: phone };
  }

  const login = trimmed.toLowerCase();
  return login.length <= MAX_LOGIN_LENGTH && !WHITESPACE.test(login)
    ? { kind: 'login', value: login }
    : null;
}
