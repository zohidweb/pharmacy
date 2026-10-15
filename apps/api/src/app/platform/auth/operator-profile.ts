import type { OperatorMe, OperatorSession } from '@pharmacy/shared-dto';
import { uiLocale } from '../../auth/session-profile';
import type { OperatorProfileRow } from './operator-auth.repository';

// Mapping of an operator row onto the contracts (libs/shared/dto operator-auth.ts,
// platform-system.ts). One role in the MVP (АП 6). The database stores Tajik as `tj`, the UI
// locale is `tg`; an operator always has his own language, so the fallback is never used.

export function operatorSession(
  profile: OperatorProfileRow,
  authenticatedAt: string,
): OperatorSession {
  return {
    operator: {
      id: profile.id,
      fullName: profile.fullName,
      login: profile.login,
      role: 'full_access',
    },
    authenticatedAt,
    locale: uiLocale(profile.language, 'ru'),
  };
}

export function operatorMe(profile: OperatorProfileRow): OperatorMe {
  return {
    id: profile.id,
    fullName: profile.fullName,
    login: profile.login,
    role: 'full_access',
    locale: uiLocale(profile.language, 'ru'),
    lastLoginAt: profile.lastLoginAt?.toISOString() ?? null,
  };
}
