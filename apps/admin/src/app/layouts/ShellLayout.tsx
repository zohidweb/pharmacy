import type { ReactNode } from 'react';
import { AppShell } from '@/widgets/app-shell';

/** Layout of every signed-in screen (route group app/(shell)). */
export function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
