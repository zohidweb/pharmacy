import { scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt('password', 'NaCl', 64, { N: 1024, r: 8, p: 16 }) from RFC 7914, section 12.
export const RFC7914_VECTOR =
  'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640';

// Start-up check that the runtime crypto provides the primitives ADR-0008 relies on (scrypt and
// constant-time comparison) and computes them correctly. Throws on any failure so the process
// does not start with broken password hashing. `expected` is a parameter for tests only.
export function runCryptoSelfCheck(expected: string = RFC7914_VECTOR): void {
  if (typeof timingSafeEqual !== 'function' || typeof scrypt !== 'function') {
    throw new Error(
      'Crypto self-check failed: scrypt or timingSafeEqual is not available',
    );
  }
  const derived = scryptSync('password', 'NaCl', 64, {
    N: 1024,
    r: 8,
    p: 16,
  }).toString('hex');
  if (derived !== expected) {
    throw new Error(
      'Crypto self-check failed: scrypt output does not match the RFC 7914 test vector',
    );
  }
}
