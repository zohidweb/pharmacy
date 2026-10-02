import { createHash, randomBytes } from 'node:crypto';

// Opaque random token (session ids, refresh tokens): base64url of CSPRNG bytes.
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Hex SHA-256 of a high-entropy token; what gets stored instead of the token itself.
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
