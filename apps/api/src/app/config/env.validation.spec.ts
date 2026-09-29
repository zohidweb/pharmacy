import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('applies defaults when variables are absent', () => {
    expect(validateEnv({})).toMatchObject({ NODE_ENV: 'development', APP_ENV: 'dev', PORT: 3000 });
  });

  it('converts PORT from a string', () => {
    expect(validateEnv({ PORT: '3001' }).PORT).toBe(3001);
  });

  it('rejects an unknown APP_ENV', () => {
    expect(() => validateEnv({ APP_ENV: 'staging' })).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/Invalid environment configuration/);
  });
});
