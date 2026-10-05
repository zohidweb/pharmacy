import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { createClient } from 'redis';

// Synthetic data for the auth e2e. Rows are written straight into the database the API under test
// uses, with the same two roles the API has: tenants as the platform role (an operator creates a
// network), everything else as the application role under RLS. Connection strings come from the
// environment (DATABASE_URL, PLATFORM_DATABASE_URL, REDIS_URL); nothing is hard-coded or printed.
// Every user lives in a network of its own, so tests never share state, and every identifier is
// random, so a run can be repeated on the same database.

export interface SeededUser {
  tenantId: string;
  employeeId: string;
  /** Two active stores of the network. */
  storeIds: [string, string];
  login: string;
  phone: string;
  email: string;
  /** What the operator reads out: groups of four, as the API displays it. */
  activationCode: string;
  /** Meets the password policy; becomes the password through POST /activations. */
  password: string;
}

export interface SeedOptions {
  /** `all` (default): the whole network. `first-store`: only the first store (a scope list). */
  scope?: 'all' | 'first-store';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the e2e seed`);
  return value;
}

let appPool: Pool | undefined;
let platformPool: Pool | undefined;
const newRedis = (url: string) => createClient({ url });
type Redis = ReturnType<typeof newRedis>;

let redis: Redis | undefined;

const app = (): Pool =>
  (appPool ??= new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    max: 2,
  }));

const platform = (): Pool =>
  (platformPool ??= new Pool({
    connectionString: requireEnv('PLATFORM_DATABASE_URL'),
    max: 2,
  }));

async function redisClient(): Promise<Redis> {
  if (!redis) {
    const client = newRedis(requireEnv('REDIS_URL'));
    client.on('error', () => undefined);
    await client.connect();
    redis = client;
  }
  return redis;
}

// One transaction as pharmacy_app with the tenant context set the way the API sets it.
async function asTenant<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app().connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// RFC 4648 base32 of 16 random bytes without padding: the 26-character code of the API
// (apps/api activation-code.ts); plain data conversion.
function randomActivationCode(): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of randomBytes(16)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

function digits(count: number): string {
  let out = '';
  while (out.length < count) out += randomBytes(4).readUInt32BE(0);
  return out.slice(0, count);
}

/**
 * A network with an owner role, two stores and one owner employee who has an activation code and
 * no password yet. The scope is the whole network, or only the first store.
 */
export async function seedOwner(options: SeedOptions = {}): Promise<SeededUser> {
  const suffix = randomBytes(5).toString('hex');
  const tenantId = randomUUID();
  const legalEntityId = randomUUID();
  const roleId = randomUUID();
  const employeeId = randomUUID();
  const storeIds: [string, string] = [randomUUID(), randomUUID()];
  const code = randomActivationCode();
  const user: SeededUser = {
    tenantId,
    employeeId,
    storeIds,
    login: `e2e-${suffix}`,
    // E.164, +992 and nine digits; random, so unique across runs.
    phone: `+992${digits(9)}`,
    email: `e2e-${suffix}@example.test`,
    activationCode: (code.match(/.{1,4}/g) ?? []).join('-'),
    password: `E2e-Passw0rd-${randomBytes(6).toString('hex')}`,
  };

  await platform().query(
    'insert into tenants (id, code, name) values ($1, $2, $3)',
    [tenantId, `e2e-${suffix}`, `E2E network ${suffix}`],
  );
  await asTenant(tenantId, async (client) => {
    await client.query(
      `insert into legal_entities (id, tenant_id, name, tax_id, legal_address)
       values ($1, $2, $3, $4, $5)`,
      [legalEntityId, tenantId, `E2E entity ${suffix}`, '000000000', 'E2E address'],
    );
    for (const [index, storeId] of storeIds.entries()) {
      await client.query(
        `insert into stores (id, tenant_id, legal_entity_id, name, code, address, kind)
         values ($1, $2, $3, $4, $5, $6, 'pharmacy')`,
        [
          storeId,
          tenantId,
          legalEntityId,
          `E2E store ${index + 1}`,
          `S${index + 1}`,
          'E2E store address',
        ],
      );
    }
    // The owner role has the whole permission catalog without role_permissions rows.
    await client.query(
      `insert into roles (id, tenant_id, name, is_owner, template_key)
       values ($1, $2, $3, true, 'owner')`,
      [roleId, tenantId, { ru: 'E2E owner' }],
    );
    await client.query(
      `insert into employees (id, tenant_id, role_id, login, full_name, phone, email, store_scope)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        employeeId,
        tenantId,
        roleId,
        user.login,
        `E2E owner ${suffix}`,
        user.phone,
        user.email,
        options.scope === 'first-store' ? 'list' : 'all',
      ],
    );
    if (options.scope === 'first-store') {
      await client.query(
        `insert into employee_stores (tenant_id, employee_id, store_id) values ($1, $2, $3)`,
        [tenantId, employeeId, storeIds[0]],
      );
    }
    await client.query(
      `insert into employee_credentials
         (tenant_id, employee_id, one_time_code_hash, one_time_code_expires_at)
       values ($1, $2, $3, now() + interval '1 hour')`,
      [tenantId, employeeId, sha256Hex(code)],
    );
  });

  return user;
}

/**
 * Blocks an employee the way a future employee service will: the status changes and the
 * permissions version grows in one transaction, and the cached version in Redis is dropped, so the
 * next request reloads the employee and finds the block. (There is no employee API in part 1.)
 */
export async function blockEmployee(user: SeededUser): Promise<void> {
  await asTenant(user.tenantId, (client) =>
    client.query(
      `update employees
         set status = 'blocked', permissions_version = permissions_version + 1, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [user.tenantId, user.employeeId],
    ),
  );
  await (await redisClient()).del(`pv:${user.tenantId}:${user.employeeId}`);
}

export async function closeSeed(): Promise<void> {
  const pools = [appPool, platformPool];
  appPool = undefined;
  platformPool = undefined;
  await Promise.all(pools.map((pool) => pool?.end()));
  const client = redis;
  redis = undefined;
  if (client?.isOpen) await client.close();
}
