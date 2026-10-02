import { passwordProblems } from './password-policy';

describe('passwordProblems', () => {
  it('lists the broken rules', () => {
    expect(passwordProblems('Demo1234')).toEqual([]);
    expect(passwordProblems('demo1234')).toEqual(['upper']);
    expect(passwordProblems('Demo')).toEqual(['length', 'digit']);
    expect(passwordProblems(`A1${'x'.repeat(200)}`)).toEqual(['length']);
  });
});
