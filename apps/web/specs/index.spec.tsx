import { existsSync } from 'node:fs';
import { join } from 'node:path';
import DashboardRoute from '../app/(shell)/page';
import ProfileRoute from '../app/(shell)/profile/page';
import LoginRoute from '../app/login/page';
import NotFoundRoute from '../app/not-found';
import { DashboardPage } from '@/pages/dashboard';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/not-found';
import { ProfilePage } from '@/pages/profile';

describe('web FSD structure', () => {
  it('routes re-export pages from the pages layer', () => {
    expect(LoginRoute).toBe(LoginPage);
    expect(DashboardRoute).toBe(DashboardPage);
    expect(ProfileRoute).toBe(ProfilePage);
    expect(NotFoundRoute).toBe(NotFoundPage);
  });

  it('keeps the empty root pages/ folder that shields src/pages from Next.js routing', () => {
    expect(existsSync(join(__dirname, '..', 'pages', 'README.md'))).toBe(true);
  });
});
