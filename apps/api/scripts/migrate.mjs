// Applies pending SQL migrations (ADR-0006, Up only) with node-pg-migrate.
// Connects with MIGRATION_DATABASE_URL (the pharmacy_owner role); never prints the URL.
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) {
  console.error('MIGRATION_DATABASE_URL is not set; cannot run migrations.');
  process.exit(1);
}

const dir =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../migrations', import.meta.url));

try {
  const applied = await runner({
    databaseUrl,
    dir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    migrationsSchema: 'public',
    checkOrder: true,
    // Defaults kept on purpose: .sql files go through the legacy loader (a file without a
    // "-- Down Migration" section is Up-only, ADR-0006); the default ignorePattern skips
    // dotfiles such as .gitkeep; the advisory lock is on (noLock is not set).
  });
  console.log(applied.length === 0 ? 'No migrations to run.' : `Applied ${applied.length} migration(s).`);
} catch (error) {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
