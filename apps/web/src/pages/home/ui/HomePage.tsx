import { Icon } from '@pharmacy/ui';

// Placeholder until the first client-product screens land.
export function HomePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6">
      <section className="flex items-center gap-4 rounded-lg bg-surface p-6 shadow-sm">
        <span className="grid size-avatar-md place-items-center rounded-md bg-primary-subtle text-primary">
          <Icon name="store" size="lg" />
        </span>
        <h1 className="text-xl font-bold text-fg">Pharmacy</h1>
      </section>
    </main>
  );
}
