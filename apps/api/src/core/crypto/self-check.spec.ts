import { RFC7914_VECTOR, runCryptoSelfCheck } from './self-check';

describe('runCryptoSelfCheck', () => {
  it('passes with the RFC 7914 scrypt vector', () => {
    expect(RFC7914_VECTOR).toBe(
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    );
    expect(() => runCryptoSelfCheck()).not.toThrow();
  });

  it('throws when the expected digest does not match', () => {
    expect(() => runCryptoSelfCheck('00'.repeat(64))).toThrow(
      /self-check failed/i,
    );
  });
});
