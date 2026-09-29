import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('applies defaults when variables are absent', () => {
    expect(validateEnv({})).toMatchObject({ NODE_ENV: 'development', PORT: 3000 });
  });

  it('converts PORT from a string', () => {
    expect(validateEnv({ PORT: '3001' }).PORT).toBe(3001);
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/Invalid environment configuration/);
  });
});
