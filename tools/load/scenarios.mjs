// The scenarios of the load run (ADR-0009, axis Ж; plan R11–R14) and the streams they are made of. A stream is a set of
// autocannon instances: its requests take the employee round-robin (autocannon resets the context of a connection
// before every request when there is one request definition, so a connection has no identity of its own), its
// latencies are those of the 2xx answers, every status is counted, 429 apart (Review Focus 2, 3).
import autocannon from 'autocannon';
import { call } from './api.mjs';
import { buildReceipt, seededRandom } from './receipts.mjs';

/** The budgets of ADR-0009 («Бюджеты API кассы») by p97.5 / p99, ms; `flag` — no budget, a finding above it (R2). */
export const BUDGETS = {
  receipt: { p975: 300, p99: 600 },
  barcode: { p975: 100, p99: 250 },
  text: { p975: 200, p99: 400 },
  flag: { p975: 300 },
};

/**
 * Runs one stream for `seconds`: `rate` requests a second, evenly spread over the second, or `connections` ×
 * `perConnection` without a global pace (the stress). `next(context, rng)` returns `{ path, method?, body?, headers? }`;
 * `onResponse(context, status, body)` reads the answer of that request.
 */
export async function runStream(api, spec) {
  const rng = seededRandom(spec.seed ?? 1);
  const stats = { name: spec.name, kind: spec.kind, target: spec.rate ?? null, sent: 0, codes: {}, latencies: [], errors: 0 };
  const request = {
    setupRequest(req, context) {
      const built = spec.next(context, rng);
      stats.sent += 1;
      return {
        ...req,
        method: built.method ?? 'GET',
        path: `/api/v1${built.path}`,
        headers: {
          Origin: api.origin,
          Cookie: context.who.cookies,
          ...(built.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...built.headers,
        },
        body: built.body === undefined ? undefined : JSON.stringify(built.body),
      };
    },
    ...(spec.onResponse
      ? {
          onResponse(status, body, context) {
            spec.onResponse(context, status, body);
          },
        }
      : {}),
  };
  const start = (connections) => {
    // autocannon writes into the request definition it builds from: each instance gets its own
    const instance = autocannon({ url: api.url, duration: spec.seconds, timeout: 30, requests: [{ ...request }], ...connections });
    instance.on('response', (_client, status, _bytes, ms) => {
      stats.codes[status] = (stats.codes[status] ?? 0) + 1;
      if (status >= 200 && status < 300) stats.latencies.push(ms);
    });
    instance.on('reqError', () => {
      stats.errors += 1;
    });
    return instance;
  };
  let results;
  if (spec.rate) {
    // every connection of an instance starts its one-second pace at the same moment: one instance with `overallRate`
    // writes all the requests of a second in the same millisecond (final review I1). One connection an instance, the
    // starts spread over the second from a random phase of the stream
    const phase = rng();
    results = await Promise.all(
      Array.from({ length: spec.rate }, async (_, i) => {
        await new Promise((resolve) => setTimeout(resolve, ((i + phase) / spec.rate) * 1000));
        return start({ connections: 1, connectionRate: 1 });
      }),
    );
  } else {
    results = [await start({ connections: spec.connections, connectionRate: spec.perConnection })];
  }
  stats.seconds = spec.seconds;
  stats.timeouts = results.reduce((sum, result) => sum + result.timeouts, 0);
  return stats;
}

/** Round-robin over `who`: the employee of each request. */
const roundRobin = (who) => {
  let next = 0;
  return () => who[next++ % who.length];
};

/** The streams of a receipt: a new sale of the next cashier; 201 numbers and the pieces sold are collected. */
function receiptStream(fleet, sellable, { productId, seed } = {}) {
  const numbers = new Set();
  let pieces = 0;
  const cashiers = productId ? fleet.hot : fleet.cashiers;
  const pick = roundRobin(cashiers);
  return {
    numbers,
    pieces: () => pieces,
    next(context, rng) {
      context.who = pick();
      const snapshot = fleet.snapshots.get(context.who.storeId);
      const { body, key } = buildReceipt(context.who, snapshot, sellable.get(context.who.storeId), rng, { productId });
      context.pieces = body.lines.reduce((sum, line) => sum + line.quantity * line.piecesPerPack, 0);
      return { method: 'POST', path: '/receipts', body, headers: { 'Idempotency-Key': key } };
    },
    onResponse(context, status, body) {
      if (status !== 201) return;
      numbers.add(JSON.parse(body).number);
      pieces += context.pieces;
    },
    seed,
  };
}

/** The changes of the snapshot since the last answer of this cashier (R2): the POS asks for them after a sale. */
function snapshotStream(fleet, cashiers) {
  const pick = roundRobin(cashiers);
  const versions = new Map(cashiers.map((c) => [c.employeeId, fleet.snapshots.get(c.storeId).version]));
  return {
    next(context) {
      context.who = pick();
      return { path: `/stores/${context.who.storeId}/catalog-snapshot?sinceVersion=${versions.get(context.who.employeeId)}` };
    },
    onResponse(context, status, body) {
      if (status === 200) versions.set(context.who.employeeId, JSON.parse(body).version);
    },
  };
}

function shiftStream(cashiers) {
  const pick = roundRobin(cashiers);
  return {
    next(context) {
      context.who = pick();
      return { path: '/shifts/current' };
    },
  };
}

/** The back-office search (R1): by barcode (known and unknown), by text (RU and TJ words, prefixes of МНН). */
function searchStream(fleet, terms, kind) {
  const pick = roundRobin(fleet.managers);
  return {
    next(context, rng) {
      context.who = pick();
      const list = kind === 'barcode' ? terms.barcodes : terms.words;
      const term = encodeURIComponent(list[Math.floor(rng() * list.length)]);
      return kind === 'stock'
        ? { path: `/stores/${context.who.storeId}/stock-products?query=${term}&limit=20` }
        : { path: `/catalog/products?q=${term}&limit=20` };
    },
  };
}

/**
 * R11: 15 minutes of the pilot ×5 — 28 requests a second in six streams; `factor` multiplies every rate (×2 — the
 * headroom ADR-0009 asks for, measured as a profile and not only as the stress).
 */
export function profile(api, fleet, { sellable, terms, seconds, factor = 1 }) {
  const receipts = receiptStream(fleet, sellable, { seed: 11 });
  const at = (rate) => Math.max(1, Math.round(rate * factor));
  return {
    receipts,
    streams: Promise.all([
      runStream(api, { name: 'POST /receipts', kind: 'receipt', rate: at(5), seconds, ...receipts }),
      runStream(api, { name: 'GET catalog-snapshot (delta)', kind: 'flag', rate: at(9), seconds, seed: 12, ...snapshotStream(fleet, fleet.cashiers) }),
      runStream(api, { name: 'GET /shifts/current', kind: 'flag', rate: at(5), seconds, seed: 13, ...shiftStream(fleet.cashiers) }),
      runStream(api, { name: 'GET /catalog/products?q=<штрихкод>', kind: 'barcode', rate: at(3), seconds, seed: 14, ...searchStream(fleet, terms, 'barcode') }),
      runStream(api, { name: 'GET /catalog/products?q=<текст>', kind: 'text', rate: at(3), seconds, seed: 15, ...searchStream(fleet, terms, 'text') }),
      runStream(api, { name: 'GET stock-products?query=<текст>', kind: 'text', rate: at(3), seconds, seed: 16, ...searchStream(fleet, terms, 'stock') }),
    ]),
  };
}

/** R12: the cashiers of L01 sell one product of one batch, 4 receipts a second each (below 300 a minute). */
export function hot(api, fleet, { sellable, hotProductId, seconds }) {
  const receipts = receiptStream(fleet, sellable, { productId: hotProductId, seed: 21 });
  return {
    receipts,
    streams: Promise.all([
      runStream(api, {
        name: 'POST /receipts (горячая партия)',
        kind: 'receipt',
        rate: 4 * fleet.hot.length,
        seconds,
        ...receipts,
      }),
    ]),
  };
}

/** R13: every cashier at the limit of his route, the GET streams on 50 connections without a global pace. */
export function stress(api, fleet, { sellable, terms, seconds }) {
  const receipts = receiptStream(fleet, sellable, { seed: 31 });
  const some = fleet.cashiers.slice(0, 20);
  return {
    receipts,
    streams: Promise.all([
      runStream(api, { name: 'POST /receipts', kind: 'receipt', connections: fleet.cashiers.length, perConnection: 4, seconds, ...receipts }),
      runStream(api, { name: 'GET catalog-snapshot (delta)', kind: 'flag', connections: some.length, perConnection: 4, seconds, seed: 32, ...snapshotStream(fleet, some) }),
      runStream(api, { name: 'GET /shifts/current', kind: 'flag', connections: some.length, perConnection: 4, seconds, seed: 33, ...shiftStream(some) }),
      runStream(api, { name: 'GET /catalog/products?q=', kind: 'text', connections: fleet.managers.length, perConnection: 4, seconds, seed: 34, ...searchStream(fleet, terms, 'text') }),
      runStream(api, { name: 'GET stock-products?query=', kind: 'text', connections: fleet.managers.length, perConnection: 4, seconds, seed: 35, ...searchStream(fleet, terms, 'stock') }),
    ]),
  };
}

/**
 * R14: 200 receipts accepted and sent again with the same key and body (201, the same number), 20 of them with the
 * same key and another body (409), 50 pairs of one receipt sent at once (one receipt each).
 */
export async function replay(api, fleet, { sellable }) {
  const rng = seededRandom(41);
  const pick = roundRobin(fleet.cashiers);
  const send = (who, body, key) => call(api, 'POST', '/receipts', { jar: who.jar, body, headers: { 'Idempotency-Key': key } });
  const make = () => {
    const who = pick();
    return { who, ...buildReceipt(who, fleet.snapshots.get(who.storeId), sellable.get(who.storeId), rng) };
  };
  const checks = [];
  const tally = (name, ok, detail) => checks.push({ name, ok, detail });
  let accepted = 0;

  const first = [];
  for (let i = 0; i < 200; i += 10) {
    const batch = Array.from({ length: 10 }, make);
    const answers = await Promise.all(batch.map((r) => send(r.who, r.body, r.key)));
    answers.forEach((answer, j) => first.push({ ...batch[j], answer }));
  }
  accepted += first.filter((r) => r.answer.status === 201).length;
  tally('200 чеков приняты', accepted === 200, `${accepted} из 200 — 201`);

  const again = [];
  for (let i = 0; i < first.length; i += 10) {
    const part = first.slice(i, i + 10);
    again.push(...(await Promise.all(part.map((r) => send(r.who, r.body, r.key)))));
  }
  const sameNumber = again.filter((a, i) => a.status === 201 && a.body?.number === first[i].answer.body?.number).length;
  tally('повтор тем же ключом и телом — 201 и тот же номер', sameNumber === first.length, `${sameNumber} из ${first.length}`);

  const conflicts = await Promise.all(
    first.slice(0, 20).map((r) => send(r.who, { ...r.body, language: r.body.language === 'ru' ? 'tj' : 'ru' }, r.key)),
  );
  const conflict409 = conflicts.filter((a) => a.status === 409 && a.body?.code === 'idempotency_conflict').length;
  tally('тот же ключ, другое тело — 409', conflict409 === 20, `${conflict409} из 20 — 409 idempotency_conflict`);

  const pairs = Array.from({ length: 50 }, make);
  const answers = await Promise.all(pairs.flatMap((r) => [send(r.who, r.body, r.key), send(r.who, r.body, r.key)]));
  let pairsOk = 0;
  pairs.forEach((_, i) => {
    const [a, b] = [answers[2 * i], answers[2 * i + 1]];
    if (a.status === 201 && b.status === 201 && a.body.number === b.body.number) pairsOk += 1;
  });
  accepted += pairs.length;
  tally('50 одновременных пар — по одному чеку', pairsOk === 50, `${pairsOk} из 50 пар — оба 201 с одним номером`);
  const codes = {};
  for (const a of [...first.map((r) => r.answer), ...again, ...conflicts, ...answers]) {
    codes[a.status] = (codes[a.status] ?? 0) + 1;
  }
  return { checks, expectedNew: accepted, codes };
}
