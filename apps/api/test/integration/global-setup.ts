import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { testDatabaseUrls } from './database-urls';

const repoRoot = join(__dirname, '..', '..', '..', '..');

// Recreates the pharmacy schema in the (already existing) test database and applies all migrations.
// Runs as pharmacy_owner. The database itself is created by docker/postgres/initdb (Task 2).
export default async function globalSetup(): Promise<void> {
  const urls = testDatabaseUrls(process.env);

  const client = new Client({ connectionString: urls.owner, application_name: 'pharmacy-it-setup' });
  await client.connect();
  try {
    await client.query('drop schema if exists pharmacy cascade');
    await client.query('drop table if exists public.pgmigrations');
    // Same script that prepares the dev database on first container start; it is multi-statement,
    // so it goes through the simple query protocol (no parameters).
    await client.query(readFileSync(join(repoRoot, 'docker', 'postgres', 'initdb', '02-database.sql'), 'utf8'));
  } finally {
    await client.end();
  }

  const result = spawnSync(process.execPath, [join(repoRoot, 'apps', 'api', 'scripts', 'migrate.mjs')], {
    env: { ...process.env, MIGRATION_DATABASE_URL: urls.owner },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Migration runner failed (exit ${result.status}):\n${result.stdout}${result.stderr}`);
  }
}
