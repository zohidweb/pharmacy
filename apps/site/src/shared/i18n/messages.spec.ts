import ru from './messages/ru.json';
import tg from './messages/tg.json';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('site dictionaries', () => {
  it('have the same keys in RU and TJ', () => {
    expect(keyPaths(tg).sort()).toEqual(keyPaths(ru).sort());
  });

  it('have no empty strings', () => {
    for (const dictionary of [ru, tg]) {
      const empty = keyPaths(dictionary).filter((path) => {
        const value = path
          .split('.')
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown>)[key],
            dictionary,
          );
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(empty).toEqual([]);
    }
  });

  // spec 4.2 of the redesign: the site's texts use a full stop, a colon or a comma instead of a dash
  // both dictionaries in one list, each path named by its language: a red RU does not hide the TG paths
  it('have no em or en dashes', () => {
    const dashed = Object.entries({ ru, tg }).flatMap(([lang, dictionary]) =>
      keyPaths(dictionary)
        .filter((path) => {
          const value = path
            .split('.')
            .reduce<unknown>(
              (node, key) => (node as Record<string, unknown>)[key],
              dictionary,
            );
          return typeof value === 'string' && /[\u2013\u2014]/.test(value);
        })
        .map((path) => `${lang}: ${path}`),
    );
    expect(dashed).toEqual([]);
  });

  it('use NFC-normalized Tajik letters', () => {
    const text = JSON.stringify(tg);
    expect(text).toBe(text.normalize('NFC'));
  });
});
