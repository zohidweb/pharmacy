// Seeds the platform drug reference from a CSV file (ADR-0013; plan 2026-11-11-drug-reference-seed, R1-R7). Usage:
//   node apps/api/scripts/seed-drug-reference.mjs [--file <path>] [--dry-run]
// Without --file the CSV comes from stdin — so in test and prod it runs from the image of the API:
//   docker compose … run --rm --no-deps -T api node scripts/seed-drug-reference.mjs --dry-run < reference.csv
//
// The file: CSV in UTF-8 (a BOM is allowed), separated by `;` or `,`, quotes by RFC 4180. Columns by the header,
// case-insensitive: barcode and name_ru are required; name_tj, inn, form, dosage, manufacturer, country (ISO 3166-1
// alpha-2) and prescription (none / rx / controlled) are optional; other columns are ignored.
//
// Rules: a barcode must be a GTIN (8, 12, 13 or 14 digits with a valid check digit) and not an internal store code;
// a barcode with different names in the file is a conflict and is not loaded; rows with the same name make one
// entry with several barcodes; a barcode already in the reference is skipped (entries are never overwritten); a new
// barcode of a name already in the reference joins that entry. One transaction under an advisory lock; --dry-run
// rolls it back.
//
// Reads PLATFORM_DATABASE_URL (the pharmacy_platform role). Prints counters and line numbers only — never values of
// the file or the connection string. Errors go to stderr with exit code 1.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;
const MAX_TEXT = 200;
const SHOWN_LINES = 50;
const BATCH = 1000;
const JOB = 'seed-drug-reference';
const ACTOR = `system:${JOB}`;

const KNOWN_COLUMNS = [
  'barcode',
  'name_ru',
  'name_tj',
  'inn',
  'form',
  'dosage',
  'manufacturer',
  'country',
  'prescription',
];
const PRESCRIPTIONS = new Set(['none', 'rx', 'controlled']);

class UserError extends Error {}

const USAGE =
  'Usage: node apps/api/scripts/seed-drug-reference.mjs [--file <path>] [--dry-run]\n' +
  'Without --file the CSV is read from stdin. Columns: barcode, name_ru (required); name_tj, inn, form, dosage,\n' +
  'manufacturer, country, prescription (optional).';

// --- Arguments and input ------------------------------------------------------------------------

function parseArgs(argv) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  const known = new Set(['--file', '--dry-run']);
  let file;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!known.has(arg)) throw new UserError(USAGE);
    if (arg === '--file') {
      file = argv[i + 1];
      if (file === undefined || file.startsWith('--')) throw new UserError(USAGE);
      i++;
    }
  }
  return { file, dryRun: argv.includes('--dry-run') };
}

async function readInput(file) {
  if (file !== undefined) {
    let size;
    try {
      size = statSync(file).size;
    } catch {
      throw new UserError('The file cannot be read.');
    }
    if (size > MAX_BYTES) throw new UserError('The file is larger than 10 MB.');
    return readFileSync(file);
  }
  if (process.stdin.isTTY) throw new UserError(USAGE);
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new UserError('The file is larger than 10 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decode(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UserError('The file is not UTF-8: save it as «CSV UTF-8».');
  }
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

// --- CSV (RFC 4180) -----------------------------------------------------------------------------

/** `;` or `,` — whichever the first line has more of outside quotes; a tie is `;` (the Russian Excel). */
function separatorOf(text) {
  let semicolons = 0;
  let commas = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted) {
      if (ch === '\n' || ch === '\r') break;
      if (ch === ';') semicolons++;
      else if (ch === ',') commas++;
    }
  }
  return commas > semicolons ? ',' : ';';
}

/** Records with the file line where each starts; a quoted field may hold separators, quotes ("") and line breaks. */
function parseCsv(text) {
  const separator = separatorOf(text);
  const records = [];
  let cells = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === separator) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(field);
      records.push({ line: recordLine, cells });
      cells = [];
      field = '';
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (quoted) throw new UserError(`Line ${recordLine}: a quote is not closed.`);
  if (field !== '' || cells.length > 0) {
    cells.push(field);
    records.push({ line: recordLine, cells });
  }
  return records;
}

// --- Values -------------------------------------------------------------------------------------

/** NFC, non-breaking spaces and line breaks become spaces, repeats collapse, edges trimmed. */
const clean = (value) =>
  (value ?? '')
    .normalize('NFC')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Names compare without case and with `ё` as `е`. */
const nameKey = (name) => name.toLocaleLowerCase('ru').replace(/ё/g, 'е');

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const textOk = (value) => value.length <= MAX_TEXT && !INVISIBLE.test(value);

/** GTIN check digit: weights 3 and 1 from the right, the check digit excluded. */
function gtinValid(code) {
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/**
 * Restricted circulation numbers of GS1: codes a shop gives its own goods. Another network would read the same code
 * as a different product, so the shared reference does not take them.
 */
function internalCode(code) {
  if (code.length === 13) return /^(2|02|04)/.test(code);
  if (code.length === 12) return /^[24]/.test(code);
  if (code.length === 8) return /^[02]/.test(code);
  return false;
}

const PROBLEMS = {
  no_barcode: 'no barcode',
  barcode_format: 'barcode is not 8, 12, 13 or 14 digits',
  barcode_check: 'barcode check digit is wrong',
  barcode_internal: 'internal store code',
  name: 'name_ru missing, longer than 200 characters or with invisible characters',
  text: 'a text column longer than 200 characters or with invisible characters',
  prescription: 'prescription is not none, rx or controlled',
};

/** A data row → a reference row, or the code of its problem. */
function readRow(get) {
  const code = clean(get('barcode')).replace(/\s/g, '');
  if (code === '') return { problem: 'no_barcode' };
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) {
    return { problem: 'barcode_format' };
  }
  if (!gtinValid(code)) return { problem: 'barcode_check' };
  if (internalCode(code)) return { problem: 'barcode_internal' };

  const nameRu = clean(get('name_ru'));
  if (nameRu === '' || !textOk(nameRu)) return { problem: 'name' };
  const texts = {};
  for (const column of ['name_tj', 'inn', 'form', 'dosage', 'manufacturer']) {
    const value = clean(get(column));
    if (!textOk(value)) return { problem: 'text' };
    texts[column] = value === '' ? null : value;
  }
  const prescription = clean(get('prescription')).toLowerCase() || 'none';
  if (!PRESCRIPTIONS.has(prescription)) return { problem: 'prescription' };
  const countryText = clean(get('country')).toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryText) ? countryText : null;

  return {
    row: {
      code,
      nameRu,
      key: nameKey(nameRu),
      nameTj: texts.name_tj,
      inn: texts.inn,
      form: texts.form,
      dosage: texts.dosage,
      manufacturer: texts.manufacturer,
      country,
      countryIgnored: countryText !== '' && country === null,
      prescription,
    },
  };
}

// --- The file → entries -------------------------------------------------------------------------

function readFile(text) {
  const records = parseCsv(text).filter((record) =>
    record.cells.some((cell) => clean(cell) !== ''),
  );
  if (records.length === 0) throw new UserError('The file is empty.');
  const [header, ...data] = records;
  const columns = new Map();
  header.cells.forEach((cell, index) => {
    const name = clean(cell).toLowerCase();
    if (!KNOWN_COLUMNS.includes(name)) return;
    if (columns.has(name)) throw new UserError(`The column ${name} is repeated in the header.`);
    columns.set(name, index);
  });
  if (!columns.has('barcode') || !columns.has('name_ru')) {
    throw new UserError('The header must have the columns barcode and name_ru.');
  }
  if (data.length > MAX_ROWS) throw new UserError(`More than ${MAX_ROWS} data rows: split the file.`);

  const problems = new Map(Object.keys(PROBLEMS).map((key) => [key, []]));
  const countryIgnored = [];
  const rows = [];
  for (const record of data) {
    const get = (column) =>
      columns.has(column) ? record.cells[columns.get(column)] : undefined;
    const result = readRow(get);
    if (result.problem) problems.get(result.problem).push(record.line);
    else {
      rows.push({ ...result.row, line: record.line });
      if (result.row.countryIgnored) countryIgnored.push(record.line);
    }
  }

  // A barcode with two different names: nobody can tell which is right, so it goes nowhere.
  const byCode = new Map();
  for (const row of rows) {
    const seen = byCode.get(row.code);
    if (!seen) byCode.set(row.code, { key: row.key, lines: [row.line], conflict: false });
    else {
      seen.lines.push(row.line);
      if (seen.key !== row.key) seen.conflict = true;
    }
  }
  const conflictLines = [];
  let conflictCodes = 0;
  let repeated = 0;
  for (const seen of byCode.values()) {
    if (seen.conflict) {
      conflictCodes++;
      conflictLines.push(...seen.lines);
    } else repeated += seen.lines.length - 1;
  }

  // Rows of one name make one entry; an attribute comes from the first row that has it.
  const entries = new Map();
  for (const row of rows) {
    if (byCode.get(row.code).conflict) continue;
    let entry = entries.get(row.key);
    if (!entry) {
      entry = { key: row.key, nameRu: row.nameRu, codes: new Set() };
      entries.set(row.key, entry);
    }
    entry.codes.add(row.code);
    for (const attribute of ['nameTj', 'inn', 'form', 'dosage', 'manufacturer', 'country']) {
      if (entry[attribute] == null && row[attribute] !== null) entry[attribute] = row[attribute];
    }
    if (entry.prescription === undefined || entry.prescription === 'none') {
      entry.prescription = row.prescription;
    }
  }

  return {
    dataRows: data.length,
    problems,
    countryIgnored,
    conflictCodes,
    conflictLines: conflictLines.sort((a, b) => a - b),
    repeated,
    entries: [...entries.values()],
  };
}

// --- Writing ------------------------------------------------------------------------------------

async function insertInBatches(client, text, records) {
  for (let i = 0; i < records.length; i += BATCH) {
    await client.query(text, [JSON.stringify(records.slice(i, i + BATCH))]);
  }
}

async function write(client, parsed, digest) {
  await client.query("select set_config('app.actor', $1, true)", [ACTOR]);
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [JOB]);

  const codes = parsed.entries.flatMap((entry) => [...entry.codes]);
  const existingCodes = new Set(
    (
      await client.query(
        'select barcode from pharmacy.drug_reference_barcodes where barcode = any($1::text[])',
        [codes],
      )
    ).rows.map((row) => row.barcode),
  );
  // Active entries by name; with several of one name the oldest (UUIDv7 ids grow with time).
  const existingNames = new Map();
  for (const row of (
    await client.query(
      `select id, name ->> 'ru' as name from pharmacy.drug_reference
       where status = 'active' order by id`,
    )
  ).rows) {
    const key = nameKey(clean(row.name));
    if (!existingNames.has(key)) existingNames.set(key, row.id);
  }

  const created = [];
  const extended = [];
  const barcodes = [];
  let barcodesExisting = 0;
  for (const entry of parsed.entries) {
    const fresh = [...entry.codes].filter((code) => !existingCodes.has(code));
    barcodesExisting += entry.codes.size - fresh.length;
    if (fresh.length === 0) continue;
    let id = existingNames.get(entry.key);
    if (id) extended.push(id);
    else {
      id = uuidv7();
      created.push({
        id,
        name: entry.nameTj ? { ru: entry.nameRu, tj: entry.nameTj } : { ru: entry.nameRu },
        inn: entry.inn ? { ru: entry.inn } : null,
        dosage_form: entry.form ?? null,
        dosage: entry.dosage ?? null,
        manufacturer: entry.manufacturer ?? null,
        country: entry.country ?? null,
        is_prescription: entry.prescription !== 'none',
        is_controlled: entry.prescription === 'controlled',
      });
    }
    for (const code of fresh) barcodes.push({ barcode: code, drug_reference_id: id });
  }

  await insertInBatches(
    client,
    `insert into pharmacy.drug_reference
       (id, name, inn, dosage_form, dosage, manufacturer, country, is_prescription, is_controlled)
     select id, name, inn, dosage_form, dosage, manufacturer, country, is_prescription, is_controlled
     from jsonb_to_recordset($1::jsonb) as x(id uuid, name jsonb, inn jsonb, dosage_form text, dosage text,
       manufacturer text, country text, is_prescription boolean, is_controlled boolean)`,
    created,
  );
  await insertInBatches(
    client,
    `insert into pharmacy.drug_reference_barcodes (barcode, drug_reference_id)
     select barcode, drug_reference_id from jsonb_to_recordset($1::jsonb) as x(barcode text, drug_reference_id uuid)`,
    barcodes,
  );
  const extendedIds = [...new Set(extended)];
  if (extendedIds.length > 0) {
    await client.query(
      'update pharmacy.drug_reference set updated_at = now() where id = any($1::uuid[])',
      [extendedIds],
    );
  }

  const totals = {
    entriesCreated: created.length,
    entriesExtended: extendedIds.length,
    barcodesAdded: barcodes.length,
    barcodesExisting,
  };
  await client.query(
    `insert into pharmacy.platform_audit_log (id, actor_kind, job, action, details, correlation_id)
     values ($1, 'system', $2, 'drug-reference.seeded', $3, $4)`,
    [
      uuidv7(),
      JOB,
      JSON.stringify({
        ...totals,
        rows: parsed.dataRows,
        rejected: [...parsed.problems.values()].reduce((sum, lines) => sum + lines.length, 0),
        conflictBarcodes: parsed.conflictCodes,
        fileSha256: digest,
      }),
      uuidv7(),
    ],
  );
  return totals;
}

// --- Report -------------------------------------------------------------------------------------

function lineList(lines) {
  const shown = lines.slice(0, SHOWN_LINES).join(', ');
  return lines.length > SHOWN_LINES ? `${shown} and ${lines.length - SHOWN_LINES} more` : shown;
}

function report(parsed, totals, dryRun) {
  const out = [`Data rows: ${parsed.dataRows}`];
  const rejected = [...parsed.problems.values()].reduce((sum, lines) => sum + lines.length, 0);
  out.push(`Rejected rows: ${rejected}`);
  for (const [problem, lines] of parsed.problems) {
    if (lines.length > 0) out.push(`  ${PROBLEMS[problem]}: ${lines.length} — lines ${lineList(lines)}`);
  }
  if (parsed.conflictCodes > 0) {
    out.push(
      `Barcodes with different names (not loaded): ${parsed.conflictCodes} — lines ${lineList(parsed.conflictLines)}`,
    );
  }
  if (parsed.repeated > 0) out.push(`Repeated rows (same barcode and name): ${parsed.repeated}`);
  if (parsed.countryIgnored.length > 0) {
    out.push(
      `Country not an ISO code (left empty): ${parsed.countryIgnored.length} — lines ${lineList(parsed.countryIgnored)}`,
    );
  }
  out.push(
    `Entries created: ${totals.entriesCreated}; entries given new barcodes: ${totals.entriesExtended}; ` +
      `barcodes added: ${totals.barcodesAdded}; barcodes already in the reference: ${totals.barcodesExisting}`,
  );
  out.push(dryRun ? 'Dry run: nothing was written.' : 'Written.');
  console.log(out.join('\n'));
}

// --- Command ------------------------------------------------------------------------------------

async function main() {
  const { file, dryRun } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.PLATFORM_DATABASE_URL;
  if (!databaseUrl) throw new UserError('PLATFORM_DATABASE_URL is not set.');
  const bytes = await readInput(file);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const parsed = readFile(decode(bytes));

  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: JOB,
  });
  await client.connect();
  try {
    await client.query('begin');
    try {
      const totals = await write(client, parsed, digest);
      await client.query(dryRun ? 'rollback' : 'commit');
      report(parsed, totals, dryRun);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // Only a fixed message or the error class and code: a database message may carry values.
  if (error instanceof UserError) {
    console.error(error.message);
  } else {
    console.error(
      `Could not seed the drug reference (${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}).`,
    );
  }
  process.exit(1);
});
