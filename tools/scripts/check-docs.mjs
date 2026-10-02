// Checks skills, agents, commands and architecture docs for wording that contradicts accepted ADRs
// and for broken relative links. Usage: node tools/scripts/check-docs.mjs [paths…]
// A line containing `<!-- docs-check: ok -->` is an intentional mention and is skipped.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DEFAULT_PATHS = [
  '.claude/skills',
  '.claude/agents',
  '.claude/commands',
  'CLAUDE.md',
  'docs/architecture/glossary.md',
  'docs/architecture/stack.md',
  'docs/architecture/c4',
];

const OK_MARKER = '<!-- docs-check: ok -->';

const RULES = [
  ['orm-undecided', /ORM (и инструмент миграций )?(НЕ )?не выбран|ORM не выбран/i],
  ['rejected-orm', /\b(Prisma|TypeORM|MikroORM|Drizzle)\b/i],
  ['old-db-service', /DatabaseService|tx\.query\(/],
  ['old-module-path', /apps\/api\/src\/modules\//],
  ['currency', /НБТ|курс(ы|ов)? валют|exchange[ _-]?rate/i],
  ['old-redis-client', /\bioredis\b/i],
  ['old-hash', /\bbcrypt\b/i],
  ['fsd-old-layer', /(^|[^\w])_(app|pages)\b/],
  ['ci-undecided', /CI (пока )?не выбран/i],
  ['tailwind-pending', /только после ADR-0007/i],
  ['rls-missing-ok', /current_setting\('app\.tenant_id',\s*true\)/i],
  ['uuid-default', /gen_random_uuid\(\)/i],
  ['old-alias', /@pharmacy\/shared\/(dto|domain|util)/],
];

const LINK = /\]\(([^)\s]+)\)/g;

/**
 * @param {string} path file path (relative to the repo root) used to resolve relative links
 * @param {string} text file contents
 * @param {(p: string) => boolean} exists checks a repo-relative path
 * @returns {{ line: number; rule: string; text: string }[]}
 */
export function checkText(path, text, exists) {
  const violations = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    if (lineText.includes(OK_MARKER)) return;
    const line = index + 1;
    for (const [rule, pattern] of RULES) {
      if (pattern.test(lineText)) violations.push({ line, rule, text: lineText.trim() });
    }
    for (const match of lineText.matchAll(LINK)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      const file = target.split('#')[0];
      if (!file) continue;
      const repoPath = join(dirname(path), decodeURIComponent(file)).replaceAll('\\', '/');
      if (!exists(repoPath)) violations.push({ line, rule: 'broken-link', text: target });
    }
  });
  return violations;
}

function markdownFiles(path) {
  const full = resolve(root, path);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return full.endsWith('.md') ? [full] : [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    markdownFiles(relative(root, join(full, entry.name))),
  );
}

function main(paths) {
  const exists = (p) => existsSync(resolve(root, p));
  let count = 0;
  for (const file of paths.flatMap(markdownFiles)) {
    const rel = relative(root, file).replaceAll('\\', '/');
    for (const v of checkText(rel, readFileSync(file, 'utf8'), exists)) {
      count++;
      console.log(`${rel}:${v.line}: ${v.rule}: ${v.text}`);
    }
  }
  if (count > 0) {
    console.error(`\n✖ ${count} docs-check violation(s)`);
    process.exit(1);
  }
  console.log('✔ docs-check: no violations');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PATHS);
}
