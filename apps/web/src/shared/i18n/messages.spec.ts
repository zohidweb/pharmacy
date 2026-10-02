import ruCore from './messages/ru/core.json';
import ruHome from './messages/ru/home.json';
import ruOwner from './messages/ru/owner.json';
import ruPos from './messages/ru/pos.json';
import ruPurchasing from './messages/ru/purchasing.json';
import ruStock from './messages/ru/stock.json';
import tgCore from './messages/tg/core.json';
import tgHome from './messages/tg/home.json';
import tgOwner from './messages/tg/owner.json';
import tgPos from './messages/tg/pos.json';
import tgPurchasing from './messages/tg/purchasing.json';
import tgStock from './messages/tg/stock.json';

const ruGroups = [ruCore, ruPos, ruHome, ruStock, ruPurchasing, ruOwner];
const tgGroups = [tgCore, tgPos, tgHome, tgStock, tgPurchasing, tgOwner];
const ru = Object.assign({}, ...ruGroups);
const tg = Object.assign({}, ...tgGroups);

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('web dictionaries', () => {
  it('keep every namespace in exactly one group', () => {
    const namespaces = ruGroups.flatMap((group) => Object.keys(group));
    expect(new Set(namespaces).size).toBe(namespaces.length);
    tgGroups.forEach((group, index) =>
      expect(Object.keys(group).sort()).toEqual(
        Object.keys(ruGroups[index]).sort(),
      ),
    );
  });

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
