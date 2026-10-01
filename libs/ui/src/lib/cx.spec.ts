import { cx } from './cx';

describe('cx', () => {
  it('joins truthy class names with spaces', () => {
    expect(cx('a', 'b')).toBe('a b');
  });

  it('skips falsy values', () => {
    const active = false;
    expect(cx('a', active && 'b', null, undefined, '', 'c')).toBe('a c');
  });
});
