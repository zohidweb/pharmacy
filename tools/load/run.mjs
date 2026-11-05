#!/usr/bin/env node
// The POS load run (ADR-0009, axis Ж; docs/guides/load-test.md):
//
//   node tools/load/run.mjs --scenario profile|hot|stress|replay|all [--minutes N] [--cashiers N] [--pause S] [--api docker|host]
//                          [--driver docker|host] [--factor F]
//
// Starts the API of the run, builds the fleet, runs the scenarios and writes tools/load/results/<time>/summary.md and
// summary.json: per stream the requests, the rate, p50…p99 of the 2xx answers against the budgets of ADR-0009, the
// statuses (429 apart), the invariants checked in the database, PASS or FAIL. No cookie, PIN or password in them.
import { spawn, spawnSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCKER_NETWORK, NODE_IMAGE, startApi } from './api.mjs';
import { at, meta } from './db.mjs';
import { RESULTS_DIR, ROOT } from './env.mjs';
import { setupFleet } from './fleet.mjs';
import { sellable } from './receipts.mjs';
import { BUDGETS, hot, profile, replay, stress } from './scenarios.mjs';

const MINUTES = { profile: 15, hot: 3, stress: 5 };
/** The stress gate (R13): the API keeps at least this throughput under 250 cashiers at their limit. */
const STRESS_GATE = { receiptsPerSecond: 10, getsPerSecond: 50 };

function args() {
  const argv = process.argv.slice(2);
  const value = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const scenario = value('scenario', 'all');
  if (!['profile', 'hot', 'stress', 'replay', 'all'].includes(scenario)) {
    throw new Error('--scenario profile | hot | stress | replay | all');
  }
  const minutes = value('minutes', null);
  return {
    scenarios: scenario === 'all' ? ['profile', 'hot', 'stress', 'replay'] : [scenario],
    minutes: minutes === null ? null : Number(minutes),
    cashiers: Number(value('cashiers', 250)),
    factor: Number(value('factor', 1)),
    pause: Number(value('pause', 60)),
    api: value('api', 'docker'),
    driver: value('driver', 'docker'),
  };
}

/** Nearest-rank percentile of sorted values. */
const percentile = (sorted, p) => (sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]);

function streamReport(stats) {
  const sorted = [...stats.latencies].sort((a, b) => a - b);
  const answered = Object.values(stats.codes).reduce((a, b) => a + b, 0);
  const p = (q) => (percentile(sorted, q) === null ? null : Math.round(percentile(sorted, q)));
  const report = {
    name: stats.name,
    kind: stats.kind,
    requests: answered,
    perSecond: Number((answered / stats.seconds).toFixed(1)),
    target: stats.target,
    p50: p(50),
    p90: p(90),
    p975: p(97.5),
    p99: p(99),
    codes: stats.codes,
    rateLimited: stats.codes[429] ?? 0,
    serverErrors: Object.entries(stats.codes)
      .filter(([code]) => Number(code) >= 500)
      .reduce((sum, [, n]) => sum + n, 0),
    errors: stats.errors,
    timeouts: stats.timeouts,
    inFlightAtStop: Math.max(0, stats.sent - answered - stats.errors),
  };
  const budget = BUDGETS[stats.kind];
  report.budget = budget;
  if (sorted.length === 0) report.verdict = 'NO DATA';
  else if (stats.kind === 'flag') report.verdict = report.p975 > budget.p975 ? 'FLAG' : 'ok';
  else report.verdict = report.p975 <= budget.p975 && report.p99 <= budget.p99 ? 'PASS' : 'FAIL';
  return report;
}

/** The state the invariants of a scenario compare: the moment, the receipts, the stock of the hot batch. */
async function snapshotDb(tenant, hotBatchId) {
  const row = await at(
    `select now()::text || '|' || (select count(*) from pharmacy.receipts where tenant_id = :'t') || '|' ||
       (select coalesce(sum(qty_delta_pieces), 0) from pharmacy.stock_movements where tenant_id = :'t' and batch_id = :'b')`,
    { t: tenant, b: hotBatchId },
  );
  const [moment, receipts, hotStock] = row.split('|');
  return { moment, receipts: Number(receipts), hotStock: Number(hotStock) };
}

async function invariants(tenant, hotBatchId, before, after, { numbers, inFlight, hotPieces, expectedNew }) {
  const vars = { t: tenant, b: hotBatchId, since: before.moment };
  const checks = [];
  const created = after.receipts - before.receipts;
  if (expectedNew !== undefined) {
    checks.push({ name: 'новых чеков в базе = принятых', ok: created === expectedNew, detail: `${created} в базе, ${expectedNew} принято` });
  } else {
    // a request cut at the end of the stream may still have committed: up to the in-flight ones more
    checks.push({
      name: 'новых чеков в базе = ответов 201 с новыми номерами',
      ok: created >= numbers && created <= numbers + inFlight,
      detail: `${created} в базе, ${numbers} ответов 201, ${inFlight} без ответа при остановке`,
    });
  }
  const duplicates = Number(
    await at(
      `select count(*) from (select 1 from pharmacy.receipts where tenant_id = :'t' and created_at >= :'since'
       group by store_id, number having count(*) > 1) x`,
      vars,
    ),
  );
  checks.push({ name: 'номера чеков уникальны', ok: duplicates === 0, detail: `${duplicates} повторов` });
  const unmoved = Number(
    await at(
      `select count(*) from pharmacy.receipt_lines l join pharmacy.receipts r on r.tenant_id = l.tenant_id and r.id = l.receipt_id
       where r.tenant_id = :'t' and r.created_at >= :'since'
         and (select count(*) from pharmacy.stock_movements m where m.tenant_id = l.tenant_id and m.source_id = l.receipt_id
              and m.source_line_id = l.id and m.kind = 'sale') <> 1`,
      vars,
    ),
  );
  checks.push({ name: 'одно движение на строку чека', ok: unmoved === 0, detail: `${unmoved} строк без ровно одного движения` });
  const hotBalance = await at(
    `select (select sum(qty_delta_pieces) from pharmacy.stock_movements where tenant_id = :'t' and batch_id = :'b') || '|' ||
       ((select qty_pieces from pharmacy.goods_receipt_lines where tenant_id = :'t' and batch_id = :'b')
        - (select coalesce(sum(qty_pieces), 0) from pharmacy.receipt_lines where tenant_id = :'t' and batch_id = :'b'))`,
    vars,
  );
  const [stock, expected] = hotBalance.split('|').map(Number);
  checks.push({ name: 'остаток горячей партии = приход − продано', ok: stock === expected && stock >= 0, detail: `${stock} шт., ожидалось ${expected}` });
  if (hotPieces !== undefined) {
    const sold = before.hotStock - after.hotStock;
    checks.push({
      name: 'продано из горячей партии = ответам 201',
      ok: sold >= hotPieces.ok && sold <= hotPieces.ok + hotPieces.inFlight,
      detail: `${sold} шт. по базе, ${hotPieces.ok} шт. в ответах 201`,
    });
  }
  return checks;
}

async function hardware() {
  const cpu = cpus();
  const vm = spawnSync('docker', ['info', '--format', '{{.NCPU}}|{{.MemTotal}}|{{.ContainersRunning}}'], { encoding: 'utf8' });
  const [vmCpus, vmMemory, containers] = vm.stdout.trim().split('|').map(Number);
  return {
    cpu: `${cpu[0]?.model ?? '?'} × ${cpu.length}`,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()}`,
    docker: { cpus: vmCpus, memoryGb: Math.round(vmMemory / 2 ** 30), containersRunning: containers },
    node: process.version,
    postgres: (await at('show server_version')).split(' ')[0],
  };
}

/** Where the numbers were taken (plan R10, ruling of task 4): the API and the driver of the load. */
function stand(summary) {
  const { api, driver } = summary.params;
  const { docker } = summary.hardware;
  const apiText =
    api === 'docker'
      ? 'API — в контейнере node:24-alpine в сети PostgreSQL и Redis, как в compose test и prod'
      : 'API — на этом ПК, база и Redis через порты Docker';
  const driverText =
    driver === 'docker'
      ? 'генератор нагрузки — в контейнере той же сети, задержка меряется в нём'
      : 'генератор нагрузки — на этом ПК, петлевой интерфейс в каждой цифре';
  return (
    `${apiText}; ${driverText}. ВМ Docker: ${docker.cpus} vCPU, ${docker.memoryGb} ГБ, контейнеров запущено ` +
    `${docker.containersRunning} (чужие проекты делят с прогоном процессор). Задержка — только по ответам 2xx.`
  );
}

const ms = (v) => (v === null ? '—' : String(v));
const codes = (c) =>
  Object.entries(c)
    .map(([code, n]) => `${code}: ${n}`)
    .join(', ');

function markdown(summary) {
  const lines = [
    `# Нагрузочный прогон кассы — ${summary.verdict}`,
    '',
    `${summary.startedAt} … ${summary.finishedAt}. Масштаб данных ${summary.params.scale}` +
      `${Number(summary.params.scale) < 1 ? ' (объём ниже ADR)' : ''}, база ${summary.database.size}, ` +
      `кассиров ${summary.params.cashiers}, заведующих ${summary.params.managers}` +
      `${summary.params.factor === 1 ? "" : `, темп профиля ×${summary.params.factor}`}.`,
    '',
    `Железо: ${summary.hardware.cpu}, ОЗУ ${summary.hardware.memoryGb} ГБ, ${summary.hardware.os}, ` +
      `Node ${summary.hardware.node}, PostgreSQL ${summary.hardware.postgres}.`,
    '',
    stand(summary),
    '',
    `Подготовка парка: ${summary.fleet.seconds} с; полный снимок точки: p50 ${summary.fleet.fullSnapshotP50} мс, ` +
      `макс. ${summary.fleet.fullSnapshotMax} мс (R2, без бюджета).`,
  ];
  for (const s of summary.scenarios) {
    lines.push('', `## ${s.name} — ${s.verdict}`, '');
    if (s.streams.length > 0) {
      lines.push(
        '| Поток | Запросов | В секунду (цель) | p50 | p90 | p97.5 | p99 | Бюджет p97.5 / p99 | Итог |',
        '|---|---|---|---|---|---|---|---|---|',
      );
      for (const r of s.streams) {
        const budget = r.kind === 'flag' ? `флаг > ${r.budget.p975}` : `${r.budget.p975} / ${r.budget.p99}`;
        lines.push(
          `| ${r.name} | ${r.requests} | ${r.perSecond}${r.target ? ` (${r.target})` : ''} | ${ms(r.p50)} | ${ms(r.p90)} | ` +
            `${ms(r.p975)} | ${ms(r.p99)} | ${budget} | ${r.verdict} |`,
        );
      }
      lines.push('', 'Коды ответов:', '');
      for (const r of s.streams) {
        lines.push(
          `- ${r.name}: ${codes(r.codes) || 'нет ответов'}; 429 — ${r.rateLimited}; 5xx — ${r.serverErrors}; ` +
            `ошибок соединения — ${r.errors}, таймаутов — ${r.timeouts}, без ответа при остановке — ${r.inFlightAtStop}`,
        );
      }
    }
    if (s.codes) lines.push('', `Коды ответов: ${codes(s.codes)}`);
    lines.push('', 'Проверки:', '');
    for (const c of s.checks) lines.push(`- ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

/** A scenario in this process (`--driver host`, for debugging): the loopback of the PC is part of every number. */
async function inProcess(api, fleet, name, context) {
  const run = { profile, hot, stress }[name](api, fleet, context);
  const streams = await run.streams;
  return { streams, receipts: { numbers: run.receipts.numbers.size, pieces: run.receipts.pieces() } };
}

/**
 * A scenario in a container on the network of the API (driver.mjs, the default): the fleet with its cookies goes on
 * stdin, the statistics come back on stdout.
 */
async function inDocker(api, fleet, { scenario, seconds, terms, hotProductId, factor }) {
  const input = {
    scenario,
    seconds,
    factor,
    terms,
    hotProductId,
    api: { url: api.internalUrl, origin: api.origin },
    fleet: {
      cashiers: fleet.cashiers.map(({ jar, ...cashier }) => cashier),
      managers: fleet.managers.map(({ jar, ...manager }) => manager),
      hot: fleet.hot.map(({ jar, ...cashier }) => cashier),
      snapshots: Object.fromEntries(fleet.snapshots),
    },
  };
  const child = spawn(
    'docker',
    ['run', '--rm', '-i', '--network', DOCKER_NETWORK, '-v', `${ROOT}:/app:ro`, '-w', '/app', NODE_IMAGE, 'node', 'tools/load/driver.mjs'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (err += chunk));
  const exit = new Promise((resolve) => child.on('close', resolve));
  child.stdin.end(JSON.stringify(input));
  const code = await exit;
  if (code !== 0) throw new Error(`the driver of ${scenario} exited with ${code}: ${err.trim().slice(0, 800)}`);
  return JSON.parse(out);
}

async function main() {
  const options = args();
  const state = await meta();
  if (state?.finished_at === undefined) throw new Error('pharmacy_load is not generated: node tools/load/db.mjs generate');
  const startedAt = new Date();
  const dir = join(RESULTS_DIR, startedAt.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const log = (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  const api = await startApi({ port: 3010, logFile: join(dir, 'api.log'), mode: options.api });
  log(`API ${api.url} (pid ${api.pid}), results in ${dir}`);
  const summary = { startedAt: startedAt.toISOString(), params: { ...options, scale: state.scale }, scenarios: [] };
  try {
    const t0 = Date.now();
    const fleet = await setupFleet(api, { cashiers: options.cashiers, managers: 5, log });
    const fullMs = [...fleet.fullSnapshotMs].sort((a, b) => a - b);
    summary.fleet = {
      seconds: Math.round((Date.now() - t0) / 1000),
      fullSnapshotP50: Math.round(percentile(fullMs, 50)),
      fullSnapshotMax: Math.round(fullMs[fullMs.length - 1]),
    };
    summary.params.managers = fleet.managers.length;
    const l01 = fleet.cashiers.find((c) => c.storeCode === 'L01')?.storeId;
    fleet.hot = fleet.cashiers.filter((c) => c.storeId === l01).slice(0, 5);
    const lists = new Map([...fleet.snapshots].map(([storeId, snapshot]) => [storeId, sellable(snapshot)]));
    const termRows = await at(
      `(select 'b|' || barcode from load_gen.product order by rank limit 300)
       union all (select 'b|299' || lpad((n * 7919 % 1000000000)::text, 10, '0') from generate_series(1, 100) n)
       union all (select 'w|' || w from (select distinct lower(left(inn_ru, 5)) as w from load_gen.product
                                           union select distinct lower(inn_tj) from load_gen.product
                                           union select distinct lower(inn_ru) from load_gen.product
                                           union select unnest(array['ҳабҳо', 'шарбат', 'капсулы', 'мазь', 'нет такого товара'])) x)`,
    );
    const terms = { barcodes: [], words: [] };
    for (const row of termRows.split('\n')) (row.startsWith('b|') ? terms.barcodes : terms.words).push(row.slice(2));
    const context = { sellable: lists, terms, hotProductId: state.hot_product_id };
    const hotPiecesPerPack =
      fleet.snapshots.get(l01)?.products.find((p) => p.id === state.hot_product_id)?.piecesPerPack ?? 1;

    for (const [index, name] of options.scenarios.entries()) {
      if (index > 0 && options.pause > 0) {
        log(`pause ${options.pause} s`);
        await new Promise((resolve) => setTimeout(resolve, options.pause * 1000));
      }
      const seconds = Math.round((options.minutes ?? MINUTES[name] ?? 0) * 60);
      log(`${name}${name === 'replay' ? '' : `: ${seconds} s`}`);
      const before = await snapshotDb(state.tenant_id, state.hot_batch_id);
      const scenario = { name, streams: [], checks: [] };
      if (name === 'replay') {
        const result = await replay(api, fleet, context);
        scenario.checks.push(...result.checks);
        scenario.codes = result.codes;
        const after = await snapshotDb(state.tenant_id, state.hot_batch_id);
        scenario.checks.push(...(await invariants(state.tenant_id, state.hot_batch_id, before, after, { expectedNew: result.expectedNew })));
      } else {
        const run =
          options.driver === 'docker'
            ? await inDocker(api, fleet, { scenario: name, seconds, terms, hotProductId: state.hot_product_id, factor: options.factor })
            : await inProcess(api, fleet, name, { ...context, seconds, factor: options.factor });
        scenario.streams = run.streams.map(streamReport);
        const receiptStats = scenario.streams.find((s) => s.kind === 'receipt');
        const after = await snapshotDb(state.tenant_id, state.hot_batch_id);
        scenario.checks.push(
          ...(await invariants(state.tenant_id, state.hot_batch_id, before, after, {
            numbers: run.receipts.numbers,
            inFlight: receiptStats.inFlightAtStop,
            // a cut hot receipt sold at most 2 packs
            hotPieces:
              name === 'hot'
                ? { ok: run.receipts.pieces, inFlight: receiptStats.inFlightAtStop * 2 * hotPiecesPerPack }
                : undefined,
          })),
        );
        const serverErrors = scenario.streams.reduce((sum, s) => sum + s.serverErrors, 0);
        scenario.checks.push({ name: 'ни одного ответа 5xx', ok: serverErrors === 0, detail: `${serverErrors}` });
        const failedConnections = scenario.streams.reduce((sum, s) => sum + s.errors, 0);
        scenario.checks.push({ name: 'ни одной ошибки соединения или таймаута', ok: failedConnections === 0, detail: `${failedConnections}` });
        if (name !== 'stress') {
          const limited = scenario.streams.reduce((sum, s) => sum + s.rateLimited, 0);
          scenario.checks.push({ name: 'ни одного ответа 429 (лимит не мешает замеру)', ok: limited === 0, detail: `${limited}` });
        } else {
          const receiptsPerSecond = receiptStats.perSecond;
          const getsPerSecond = scenario.streams.filter((s) => s.kind !== 'receipt').reduce((sum, s) => sum + s.perSecond, 0);
          scenario.checks.push({
            name: `запас: ≥ ${STRESS_GATE.receiptsPerSecond} чеков/с и ≥ ${STRESS_GATE.getsPerSecond} GET/с`,
            ok: receiptsPerSecond >= STRESS_GATE.receiptsPerSecond && getsPerSecond >= STRESS_GATE.getsPerSecond,
            detail: `${receiptsPerSecond} чеков/с, ${getsPerSecond.toFixed(1)} GET/с`,
          });
        }
      }
      // the stress has a throughput gate instead of budgets; FLAG streams are findings, not failures (R2)
      const budgetsOk = name === 'stress' || scenario.streams.every((s) => s.verdict !== 'FAIL' && s.verdict !== 'NO DATA');
      scenario.verdict = budgetsOk && scenario.checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
      summary.scenarios.push(scenario);
      log(`${name}: ${scenario.verdict}`);
      writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    }
  } finally {
    await api.stop();
  }
  summary.finishedAt = new Date().toISOString();
  summary.hardware = await hardware();
  summary.database = { size: await at('select pg_size_pretty(pg_database_size(current_database()))') };
  summary.verdict = summary.scenarios.every((s) => s.verdict === 'PASS') ? 'PASS' : 'FAIL';
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(dir, 'summary.md'), markdown(summary));
  log(`${summary.verdict}: ${join(dir, 'summary.md')}`);
  if (summary.verdict !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
