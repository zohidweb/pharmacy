import {
  createHmac,
  randomBytes,
  scrypt,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { KeyRing } from './key-ring';

// Password and PIN hashing (ADR-0008): scrypt over HMAC-SHA-256(pepper, secret), stored as PHC.
//   $scrypt$ln=15,r=8,p=3$<salt base64>$<hash base64>   (base64 without padding)
// Only node:crypto primitives are used (ADR-0011).

const LN = 15;
const R = 8;
const P = 3;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 67_108_864;

// Upper bounds for parameters read from a stored hash, so a corrupted row cannot exhaust memory.
const MAX_LN = 16;
const MAX_R = 16;
const MAX_P = 16;

const PHC_PATTERN =
  /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface ScryptParams {
  ln: number;
  r: number;
  p: number;
}

interface ParsedPhc extends ScryptParams {
  salt: Buffer;
  hash: Buffer;
}

function deriveKey(
  password: Buffer,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

function encode(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '');
}

function parsePhc(phc: string): ParsedPhc | undefined {
  const match = PHC_PATTERN.exec(phc);
  if (!match) {
    return undefined;
  }
  const ln = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  if (ln < 1 || ln > MAX_LN || r < 1 || r > MAX_R || p < 1 || p > MAX_P) {
    return undefined;
  }
  const salt = Buffer.from(match[4], 'base64');
  const hash = Buffer.from(match[5], 'base64');
  if (salt.length !== SALT_LENGTH || hash.length !== KEY_LENGTH) {
    return undefined;
  }
  return { ln, r, p, salt, hash };
}

@Injectable()
export class PasswordHasher implements OnModuleInit {
  private readonly activeVersion: number;
  private dummyPhc: Promise<string> | undefined;

  constructor(private readonly peppers: KeyRing) {
    const version = Number(peppers.activeId);
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error(
        'The active password pepper id must be a positive integer',
      );
    }
    if (!peppers.keys.has(peppers.activeId)) {
      throw new Error('The active password pepper key is not present');
    }
    this.activeVersion = version;
  }

  // Pre-computes the dummy hash so the first unknown-login attempt costs the same as the rest.
  async onModuleInit(): Promise<void> {
    await this.getDummyPhc();
  }

  async hash(secret: string): Promise<{ phc: string; pepperVersion: number }> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await this.derive(secret, this.activeVersion, salt, {
      ln: LN,
      r: R,
      p: P,
    });
    if (!derived) {
      throw new Error('The active password pepper key is not present');
    }
    return {
      phc: `$scrypt$ln=${LN},r=${R},p=${P}$${encode(salt)}$${encode(derived)}`,
      pepperVersion: this.activeVersion,
    };
  }

  async verify(
    secret: string,
    phc: string,
    pepperVersion: number,
  ): Promise<boolean> {
    try {
      const parsed = parsePhc(phc);
      if (!parsed) {
        return false;
      }
      const derived = await this.derive(
        secret,
        pepperVersion,
        parsed.salt,
        parsed,
      );
      if (!derived || derived.length !== parsed.hash.length) {
        return false;
      }
      return timingSafeEqual(derived, parsed.hash);
    } catch {
      return false;
    }
  }

  // Burns the same time as a real check for a login that does not exist; always false.
  async verifyDummy(secret: string): Promise<false> {
    await this.verify(secret, await this.getDummyPhc(), this.activeVersion);
    return false;
  }

  needsRehash(phc: string, pepperVersion: number): boolean {
    const parsed = parsePhc(phc);
    if (!parsed) {
      return true;
    }
    return (
      parsed.ln !== LN ||
      parsed.r !== R ||
      parsed.p !== P ||
      pepperVersion !== this.activeVersion
    );
  }

  private getDummyPhc(): Promise<string> {
    this.dummyPhc ??= this.hash(randomBytes(16).toString('hex')).then(
      (result) => result.phc,
    );
    return this.dummyPhc;
  }

  private async derive(
    secret: string,
    pepperVersion: number,
    salt: Buffer,
    params: ScryptParams,
  ): Promise<Buffer | undefined> {
    const pepper = this.peppers.keys.get(String(pepperVersion));
    if (!pepper) {
      return undefined;
    }
    const peppered = createHmac('sha256', pepper)
      .update(secret, 'utf8')
      .digest();
    return deriveKey(peppered, salt, KEY_LENGTH, {
      N: 2 ** params.ln,
      r: params.r,
      p: params.p,
      maxmem: MAX_MEMORY,
    });
  }
}
