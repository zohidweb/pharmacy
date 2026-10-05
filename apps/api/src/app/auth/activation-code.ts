import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../../core/crypto';
import type { LoginKind } from '../../core/database';

// One-time activation code (auth design 2026-10-02, section 6): 128 bits from randomBytes as
// RFC 4648 base32 without padding (26 characters), shown to the operator in groups of four. Only
// its SHA-256 is stored. The encoding is plain data conversion, not cryptography.

const CODE_BYTES = 16;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_PATTERN = /^[A-Z2-7]{26}$/;
const IGNORED = /[-\s]/g;
const GROUP = 4;

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** A fresh code: `code` is what is hashed, `display` what the operator reads out. */
export function generateActivationCode(): { code: string; display: string } {
  const code = base32(randomBytes(CODE_BYTES));
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += GROUP) {
    groups.push(code.slice(i, i + GROUP));
  }
  return { code, display: groups.join('-') };
}

/** The canonical code of user input (dashes and whitespace dropped), or null when it cannot be one. */
export function normalizeActivationCode(input: string): string | null {
  const code = input.replace(IGNORED, '').toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** SHA-256 hex of a canonical code: what employee_credentials.one_time_code_hash holds. */
export function hashActivationCode(code: string): string {
  return sha256Hex(code);
}

/** Limiter key of an activation: never shared with the sign-in keys, a hash of the value only. */
export function activationLimiterKey(kind: LoginKind, value: string): string {
  return `activation:${kind}:${sha256Hex(value)}`;
}
