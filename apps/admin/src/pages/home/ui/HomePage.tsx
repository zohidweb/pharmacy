import { Icon } from '@pharmacy/ui';

// Placeholder until the app shell and dashboard land (admin UI, stage 3).
export function HomePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6">
      <section className="flex items-center gap-4 rounded-lg bg-surface p-6 shadow-sm">
        <span className="grid size-avatar-md place-items-center rounded-md bg-primary-subtle text-primary">
          <Icon name="layout-dashboard" size="lg" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-fg">Platform Admin</h1>
          <p className="text-sm text-fg-subtle">SaaS для аптечных сетей</p>
        </div>
      </section>
    </main>
  );
}
