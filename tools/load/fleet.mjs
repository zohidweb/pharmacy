// The fleet of the load run (plan R7, R11, R17): the owner, five managers and up to 250 cashiers of the network
// «Нагрузка», each cashier on a terminal of his own — a device cookie, a PIN session and an open shift, as the POS has
// them. Everything goes through the API: the PIN hash needs the pepper of the environment, the device cookie is a
// secret only the API knows. The passwords and device cookies of this database live in tools/load/.state/fleet.json
// (git-ignored, removed with the database); they are never printed.
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CookieJar, call, expect, uuidv7 } from './api.mjs';
import { OWNER_STATE, at } from './db.mjs';
import { STATE_DIR } from './env.mjs';

const FLEET_STATE = join(STATE_DIR, 'fleet.json');
/** Below the 60 sign-ins a minute an address gets on the public auth routes (AUTH_ROUTE_LIMIT, plan R7). */
const SIGN_INS_PER_MINUTE = 55;
/** Below the 300 requests a minute of one employee on one route (the owner binds and sets PINs). */
const OWNER_PER_SECOND = 4;

const readState = () => (existsSync(FLEET_STATE) ? JSON.parse(readFileSync(FLEET_STATE, 'utf8')) : {});
function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FLEET_STATE, JSON.stringify(state, null, 2));
}

const password = () => randomBytes(18).toString('base64url');

/** A PIN of six digits that is neither one digit repeated nor a run up or down. */
function pin() {
  for (;;) {
    const digits = Array.from({ length: 6 }, () => randomInt(10));
    const steps = new Set(digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10));
    if (steps.size > 1) return digits.join('');
  }
}

/** Runs `fn` over the items no faster than `perSecond`, `parallel` at a time. */
async function paced(items, perSecond, fn, parallel = 1) {
  const gap = 1000 / perSecond;
  let next = performance.now();
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++];
      const wait = next - performance.now();
      next = Math.max(next, performance.now()) + gap;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}

/** The owner's session; a new one when the step-up of the old one ran out. */
async function ownerSession(api, state) {
  const owner = JSON.parse(readFileSync(OWNER_STATE, 'utf8'));
  if (!state.ownerPassword) {
    const newPassword = password();
    // the one-time code of generate (R17): activated once per database
    await expect(api, 'POST', '/activations', { body: { login: owner.login, code: owner.code, newPassword } }, 204);
    state.ownerPassword = newPassword;
    writeState(state);
  }
  const jar = new CookieJar();
  await expect(api, 'POST', '/sessions', { jar, body: { login: owner.login, password: state.ownerPassword } }, 201);
  return jar;
}

/** A request of the owner that needs a fresh password: signs in again once on `fresh_auth_required`. */
async function asOwner(api, state, owner, method, path, options, ...statuses) {
  let result = await call(api, method, path, { ...options, jar: options.jar ?? owner.jar });
  if (result.status === 403 && result.body?.code === 'fresh_auth_required') {
    owner.jar = await ownerSession(api, state);
    result = await call(api, method, path, { ...options, jar: options.jar ?? new CookieJar({ sid: owner.jar.get('sid') }) });
  }
  if (!statuses.includes(result.status)) throw new Error(`${method} ${path}: ${result.status} ${result.body?.code ?? ''}`);
  return result;
}

async function managers(api, state, owner, count, stores) {
  const role = await at(`select id from pharmacy.roles where name ->> 'ru' = 'Заведующий точкой'`);
  state.managers ??= {};
  const result = [];
  for (let i = 1; i <= count; i += 1) {
    const login = `load.manager.${i}`;
    const store = stores[i - 1];
    if (!state.managers[login]) {
      const secret = password();
      const created = await call(api, 'POST', '/employees', {
        jar: owner.jar,
        body: {
          fullName: `Заведующий нагрузки ${i}`,
          phone: `+99290000000${i}`,
          login,
          roleId: role,
          storeIds: [store.id],
          locale: 'ru',
          password: secret,
          pin: '',
        },
      });
      if (created.status === 409 && created.body?.code === 'login_taken') {
        // the state was lost, the employee is there: a new password through the API
        const id = await at(`select id from pharmacy.employees where login = :'login'`, { login });
        await asOwner(api, state, owner, 'POST', `/employees/${id}/password`, { body: { newPassword: secret } }, 204);
      } else if (created.status !== 201) {
        throw new Error(`POST /employees: ${created.status} ${created.body?.code ?? ''}`);
      }
      state.managers[login] = { password: secret };
      writeState(state);
    }
    const jar = new CookieJar();
    await expect(api, 'POST', '/sessions', { jar, body: { login, password: state.managers[login].password } }, 201);
    result.push({ login, storeId: store.id, storeCode: store.code, jar, cookies: jar.header() });
  }
  return result;
}

/**
 * Builds the fleet of the run on a generated database (task 2). A rerun on the same database keeps the owner, the
 * managers and the terminals of .state, opens no second shift and binds a terminal only when its device cookie no
 * longer answers (Review Focus 1). One PIN for every cashier, new on each run.
 */
export async function setupFleet(api, { cashiers: count = 250, managers: managerCount = 5, log = console.log } = {}) {
  const state = readState();
  const stores = (await at(`select s.no || ',' || s.id || ',' || s.code from load_gen.store s order by s.no`))
    .split('\n')
    .map((row) => {
      const [no, id, code] = row.split(',');
      return { no: Number(no), id, code };
    });
  // one cashier a store first: a small fleet still covers every store
  const roster = (
    await at(`select c.n || ',' || c.id || ',' || c.store_no from load_gen.cashier c order by c.idx, c.store_no limit ${count}`)
  )
    .split('\n')
    .map((row) => {
      const [n, employeeId, storeNo] = row.split(',');
      const store = stores[Number(storeNo) - 1];
      return { n: Number(n), employeeId, storeId: store.id, storeCode: store.code };
    });

  const owner = { jar: await ownerSession(api, state) };
  log(`owner signed in; ${roster.length} cashiers, ${managerCount} managers`);
  const managerSessions = await managers(api, state, owner, managerCount, stores);

  // terminals: a device cookie of .state that still answers is kept, otherwise the owner binds a new one — without a
  // device cookie of his own, which binding would revoke
  state.devices ??= {};
  const toBind = [];
  for (const cashier of roster) {
    const device = state.devices[cashier.employeeId];
    const alive =
      device && (await call(api, 'GET', '/terminals/current', { jar: new CookieJar({ term: device.term }) })).status === 200;
    if (!alive) toBind.push(cashier);
  }
  await paced(toBind, OWNER_PER_SECOND, async (cashier) => {
    const name = `Нагрузка ${String(cashier.n).padStart(3, '0')}`;
    let jar = new CookieJar({ sid: owner.jar.get('sid') });
    let bound = await call(api, 'POST', '/terminals', { jar, body: { storeId: cashier.storeId, name } });
    if (bound.status === 403 && bound.body?.code === 'fresh_auth_required') {
      owner.jar = await ownerSession(api, state);
      jar = new CookieJar({ sid: owner.jar.get('sid') });
      bound = await call(api, 'POST', '/terminals', { jar, body: { storeId: cashier.storeId, name } });
    }
    if (bound.status === 409 && bound.body?.code === 'terminal_name_taken') {
      // the device cookie of .state was lost: the terminal of that name is revoked and bound anew
      const id = await at(
        `select id from pharmacy.terminals where store_id = :'store' and name = :'name' and revoked_at is null`,
        { store: cashier.storeId, name },
      );
      await asOwner(api, state, owner, 'DELETE', `/terminals/${id}`, {}, 204, 200);
      jar = new CookieJar({ sid: owner.jar.get('sid') });
      bound = await call(api, 'POST', '/terminals', { jar, body: { storeId: cashier.storeId, name } });
    }
    if (bound.status !== 201) throw new Error(`POST /terminals: ${bound.status} ${bound.body?.code ?? ''}`);
    state.devices[cashier.employeeId] = { terminalId: bound.body.id, term: jar.get('term') };
    writeState(state);
  });
  log(`terminals: ${roster.length - toBind.length} kept, ${toBind.length} bound`);

  // one PIN for every cashier of this run
  const runPin = pin();
  await paced(roster, OWNER_PER_SECOND, (cashier) =>
    asOwner(api, state, owner, 'POST', `/employees/${cashier.employeeId}/pin`, { body: { pin: runPin } }, 204),
  );
  log(`PIN set for ${roster.length} cashiers; signing in at ${SIGN_INS_PER_MINUTE} a minute`);

  const fleet = { cashiers: [], managers: managerSessions, snapshots: new Map(), fullSnapshotMs: [] };
  await paced(roster, SIGN_INS_PER_MINUTE / 60, async (cashier) => {
    const device = state.devices[cashier.employeeId];
    const jar = new CookieJar({ term: device.term });
    await expect(api, 'POST', '/terminal-sessions', { jar, body: { employeeId: cashier.employeeId, pin: runPin } }, 201);
    fleet.cashiers.push({ ...cashier, terminalId: device.terminalId, jar });
  });

  // a shift on every terminal: the open one of an earlier run, or a new one
  let opened = 0;
  await paced(
    fleet.cashiers,
    50,
    async (cashier) => {
      const current = await call(api, 'GET', '/shifts/current', { jar: cashier.jar });
      if (current.status === 200) {
        cashier.shiftId = current.body.id;
        return;
      }
      if (current.status !== 404) throw new Error(`GET /shifts/current: ${current.status} ${current.body?.code ?? ''}`);
      const id = uuidv7();
      const shift = await expect(
        api,
        'POST',
        '/shifts',
        {
          jar: cashier.jar,
          headers: { 'Idempotency-Key': id },
          body: {
            id,
            storeId: cashier.storeId,
            terminalId: cashier.terminalId,
            employeeId: cashier.employeeId,
            occurredAt: new Date().toISOString(),
            openingCashMinor: 50_000,
          },
        },
        201,
      );
      cashier.shiftId = shift.body.id;
      opened += 1;
    },
    5,
  );
  log(`shifts: ${fleet.cashiers.length - opened} open already, ${opened} opened`);

  // the full snapshot of each store by its first cashier: the POS starts from it, the run measures it (R2)
  for (const store of stores) {
    const cashier = fleet.cashiers.find((c) => c.storeId === store.id);
    if (!cashier) continue;
    const snapshot = await expect(api, 'GET', `/stores/${store.id}/catalog-snapshot`, { jar: cashier.jar }, 200);
    fleet.snapshots.set(store.id, snapshot.body);
    fleet.fullSnapshotMs.push(snapshot.ms);
  }
  for (const cashier of fleet.cashiers) cashier.cookies = cashier.jar.header();
  const ms = [...fleet.fullSnapshotMs].sort((a, b) => a - b);
  log(
    `full snapshots: ${ms.length}, ${Math.round(ms[0])}–${Math.round(ms[ms.length - 1])} ms, ` +
      `${fleet.snapshots.values().next().value?.products.length ?? 0} products a store`,
  );
  return fleet;
}
