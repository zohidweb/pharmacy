import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Page-level actions (filters, primary action). */
  actions?: ReactNode;
}

/** Title row of a screen inside the shell; global controls live in the top bar. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end gap-4 px-6 pt-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="truncate text-2xl font-bold tracking-tight text-fg">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-fg-subtle">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
