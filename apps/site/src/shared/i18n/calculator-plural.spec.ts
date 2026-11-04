import { getTranslator } from './config';

// the first ICU plural of the site's dictionaries (spec 2026-11-04-public-site-home-polish, H4)
describe('stores calculator sentence', () => {
  const ru = getTranslator('ru');
  const tg = getTranslator('tg');
  const total = (t: typeof ru, stores: number) =>
    t('home.pricing.calculator.total', { amount: '1 200 с', stores });

  it('declines the number of stores in RU', () => {
    expect(total(ru, 1)).toBe('1 200 с в месяц за 1 аптеку');
    expect(total(ru, 3)).toBe('1 200 с в месяц за 3 аптеки');
    expect(total(ru, 5)).toBe('1 200 с в месяц за 5 аптек');
    expect(total(ru, 11)).toBe('1 200 с в месяц за 11 аптек');
    expect(total(ru, 21)).toBe('1 200 с в месяц за 21 аптеку');
    expect(total(ru, 22)).toBe('1 200 с в месяц за 22 аптеки');
    expect(total(ru, 30)).toBe('1 200 с в месяц за 30 аптек');
  });

  it('renders every count of the slider in TJ (only `one` and `other`)', () => {
    for (let stores = 1; stores <= 30; stores++) {
      expect(total(tg, stores)).toBe(
        `1 200 с дар як моҳ барои ${stores} дорухона`,
      );
    }
  });
});
