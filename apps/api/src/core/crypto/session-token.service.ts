import { JwtService } from '@nestjs/jwt';
import type { KeyRing } from './key-ring';

// Session token (ADR-0008, amendment 2026-10-02, item 1): a JWT that carries identifiers only —
// the server-side session record stays the source of truth. HS256 with a 256-bit key picked by
// `kid` from the key ring, so keys rotate without logging anyone out. Signing and verification
// are done by @nestjs/jwt (jsonwebtoken v9); this class only pins the algorithm, issuer,
// audience and key selection. Tokens are never logged.

export const SESSION_TOKEN_ISSUER = 'pharmacy-api';

const ALGORITHM = 'HS256';

export type SessionAudience = 'web';

export interface SessionClaims {
  jti: string;
  sub: string;
  tid: string;
  aud: SessionAudience;
}

export type VerifiedSessionClaims = SessionClaims & {
  iat: number;
  exp: number;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

export class SessionTokenService {
  // No module options: the key is passed explicitly on every call, never a default secret.
  private readonly jwt = new JwtService();

  constructor(private readonly keyRing: KeyRing) {}

  /** Signs the claims with the active key; the payload is exactly jti, sub, tid, aud, iss, iat, exp. */
  sign(claims: SessionClaims, ttlSeconds: number): Promise<string> {
    const key = this.keyRing.keys.get(this.keyRing.activeId);
    if (!key)
      throw new Error('The active session key is missing from the key ring');
    return this.jwt.signAsync(
      { tid: claims.tid },
      {
        secret: key,
        algorithm: ALGORITHM,
        keyid: this.keyRing.activeId,
        issuer: SESSION_TOKEN_ISSUER,
        audience: claims.aud,
        subject: claims.sub,
        jwtid: claims.jti,
        expiresIn: ttlSeconds,
      },
    );
  }

  /** The verified claims, or null for any invalid, foreign, expired or malformed token. */
  async verify(
    token: string,
    audience: SessionAudience,
  ): Promise<VerifiedSessionClaims | null> {
    try {
      const key = this.keyFor(token);
      if (!key) return null;
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret: key,
          algorithms: [ALGORITHM],
          issuer: SESSION_TOKEN_ISSUER,
          audience,
        },
      );
      const { jti, sub, tid, aud, iat, exp } = payload;
      if (
        !isNonEmptyString(jti) ||
        !isNonEmptyString(sub) ||
        !isNonEmptyString(tid) ||
        aud !== audience ||
        !isTimestamp(iat) ||
        !isTimestamp(exp)
      ) {
        return null;
      }
      return { jti, sub, tid, aud, iat, exp };
    } catch {
      return null;
    }
  }

  // The header is read unverified only to choose the key; verifyAsync then checks the signature
  // with that key and the pinned algorithm, so a forged header gains nothing.
  private keyFor(token: string): Buffer | null {
    const decoded: unknown = this.jwt.decode(token, { complete: true });
    if (decoded === null || typeof decoded !== 'object') return null;
    const header: unknown = (decoded as { header?: unknown }).header;
    if (header === null || typeof header !== 'object') return null;
    const kid: unknown = (header as { kid?: unknown }).kid;
    if (typeof kid !== 'string') return null;
    return this.keyRing.keys.get(kid) ?? null;
  }
}
