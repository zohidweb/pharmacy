import {
  activationLimiterKey,
  generateActivationCode,
  normalizeActivationCode,
} from './activation-code';
import { sha256Hex } from '../../core/crypto';

describe('generateActivationCode', () => {
  it('makes 26 base32 characters shown in groups of four', () => {
    const { code, display } = generateActivationCode();

    expect(code).toMatch(/^[A-Z2-7]{26}$/);
    expect(display).toMatch(/^([A-Z2-7]{4}-){6}[A-Z2-7]{2}$/);
    expect(display.replace(/-/g, '')).toBe(code);
  });

  it('does not repeat', () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => generateActivationCode().code),
    );
    expect(codes.size).toBe(200);
  });

  it('round-trips through normalization', () => {
    const { code, display } = generateActivationCode();

    expect(normalizeActivationCode(display)).toBe(code);
    expect(normalizeActivationCode(code)).toBe(code);
  });
});

describe('normalizeActivationCode', () => {
  const code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 26);

  it('drops dashes and whitespace and upper-cases', () => {
    const display = 'abcd-efgh ijkl-MNOP\tqrst\n-uvwx-yz';
    expect(normalizeActivationCode(display)).toBe(code);
  });

  it('rejects characters outside the base32 alphabet', () => {
    expect(normalizeActivationCode(`${code.slice(0, 25)}1`)).toBeNull();
    expect(normalizeActivationCode(`${code.slice(0, 25)}0`)).toBeNull();
    expect(normalizeActivationCode(`${code.slice(0, 25)}8`)).toBeNull();
    expect(normalizeActivationCode(`${code.slice(0, 25)}=`)).toBeNull();
    expect(normalizeActivationCode(`${code.slice(0, 25)}!`)).toBeNull();
  });

  it('rejects the wrong length', () => {
    expect(normalizeActivationCode(code.slice(0, 25))).toBeNull();
    expect(normalizeActivationCode(`${code}A`)).toBeNull();
    expect(normalizeActivationCode('')).toBeNull();
    expect(normalizeActivationCode(' - ')).toBeNull();
  });
});

describe('activationLimiterKey', () => {
  it('is separate from the login key and carries a hash, never the value', () => {
    const key = activationLimiterKey('login', 'farida.r');

    expect(key).toBe(`activation:login:${sha256Hex('farida.r')}`);
    expect(key).not.toContain('farida');
  });
});
