import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The generated file is a build artifact of `nx run api:db-types`; these checks pin the
// codegen options (int8 -> bigint, camelCase keys, only the app schema) so a config
// change that silently breaks them fails here.
const source = readFileSync(join(__dirname, 'db.generated.ts'), 'utf8');

describe('db.generated.ts', () => {
  it('maps int8 to bigint (same as the pool type parser)', () => {
    expect(source).toMatch(/permissionsVersion: Generated<bigint>/);
    expect(source).not.toMatch(/Int8/);
  });

  it('uses camelCase table keys without schema prefix and skips pgmigrations', () => {
    expect(source).toMatch(/employeeStores: EmployeeStores;/);
    expect(source).not.toMatch(/pharmacy\.|pgmigrations/);
  });
});
