import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import RoutePage from '../app/page';
import { HomePage } from '@/pages/home';

describe('web FSD structure', () => {
  it('renders the root route through the pages layer', () => {
    const { baseElement } = render(<RoutePage />);
    expect(baseElement).toBeTruthy();
  });

  it('exposes HomePage via the slice public API', () => {
    expect(typeof HomePage).toBe('function');
  });

  it('keeps the empty root pages/ folder that shields src/pages from Next.js routing', () => {
    expect(existsSync(join(__dirname, '..', 'pages', 'README.md'))).toBe(true);
  });
});
