import { existsSync } from 'node:fs';
import { join } from 'node:path';
import DashboardRoute from '../app/(shell)/page';
import LoginRoute from '../app/login/page';
import { DashboardPage } from '@/pages/dashboard';
import { LoginPage } from '@/pages/login';

describe('admin FSD structure', () => {
  it('routes re-export pages from the pages layer', () => {
    expect(LoginRoute).toBe(LoginPage);
    expect(DashboardRoute).toBe(DashboardPage);
  });

  it('keeps the empty root pages/ folder that shields src/pages from Next.js routing', () => {
    expect(existsSync(join(__dirname, '..', 'pages', 'README.md'))).toBe(true);
  });
});
