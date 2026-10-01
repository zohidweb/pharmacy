import { appPool, closeAll, ownerPool } from '../../../test/integration/connections';

afterAll(closeAll);

describe('integration test stand', () => {
  it('connects as pharmacy_app with the pharmacy schema on the search path', async () => {
    const { rows } = await appPool().query(
      "select current_user as u, current_setting('search_path') as sp, current_database() as db",
    );
    expect(rows[0]).toEqual({ u: 'pharmacy_app', sp: 'pharmacy', db: 'pharmacy_test' });
  });

  it('records migrations in public.pgmigrations', async () => {
    const { rows } = await ownerPool().query("select to_regclass('public.pgmigrations') as t");
    expect(rows[0].t).toBe('public.pgmigrations');
  });
});
