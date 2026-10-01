import { activeRoute, navigation } from './navigation';

describe('activeRoute', () => {
  it.each([
    ['/', 'dashboard'],
    ['/companies', 'companies'],
    ['/companies/view', 'companies'],
    ['/companies/new', 'companyCreate'],
    ['/billing', 'invoices'],
    ['/billing/services', 'services'],
    ['/offline/licenses', 'licenses'],
    ['/stores/view', 'companies'],
    ['/profile', null],
  ])('maps %s to %s', (pathname, expected) => {
    expect(activeRoute(pathname)).toBe(expected);
  });

  it('does not treat a path prefix without a slash as nested', () => {
    expect(activeRoute('/billing-archive')).toBeNull();
  });

  it('lists every route once', () => {
    const routes = navigation.flatMap((section) =>
      section.items.map((item) => item.route),
    );
    expect(new Set(routes).size).toBe(routes.length);
  });
});
