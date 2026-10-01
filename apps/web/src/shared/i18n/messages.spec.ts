import ru from './messages/ru.json';
import tg from './messages/tg.json';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('web dictionaries', () => {
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

  it('use NFC-normalized Tajik letters', () => {
    const text = JSON.stringify(tg);
    expect(text).toBe(text.normalize('NFC'));
  });
});
