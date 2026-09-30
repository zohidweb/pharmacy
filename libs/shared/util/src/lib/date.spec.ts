import { formatDateOnly, formatDateTime } from './date.js';

describe('formatDateOnly', () => {
  it('formats YYYY-MM-DD as dd.MM.yyyy without time zone shifts', () => {
    expect(formatDateOnly('2026-11-12')).toBe('12.11.2026');
    expect(formatDateOnly('2026-01-01')).toBe('01.01.2026');
  });

  it('rejects other shapes', () => {
    expect(() => formatDateOnly('12.11.2026')).toThrow(RangeError);
    expect(() => formatDateOnly('2026-11-12T00:00:00Z')).toThrow(RangeError);
  });
});

describe('formatDateTime', () => {
  it('renders instants in Asia/Dushanbe (UTC+5) with a 24h clock', () => {
    expect(formatDateTime('2026-09-21T06:42:00Z')).toBe('21.09.2026, 11:42');
    expect(formatDateTime('2026-09-30T19:30:00Z')).toBe('01.10.2026, 00:30');
  });

  it('rejects invalid input', () => {
    expect(() => formatDateTime('not a date')).toThrow(RangeError);
  });
});
