/*
 * Common passwords (security review 2026-10-22, A2; ADR-0008, amendment 2026-10-23): a small local
 * list, no breached-password service (an external service is an integration, ADR-0011).
 */

// Keyboard runs whose digits are part of the pattern, at the start of the lowered password.
const COMMON_PREFIXES = [
  '1q2w3e',
  'q1w2e3',
  '1qaz2wsx',
  'zaq12wsx',
  'zaq1xsw2',
  '1qazxsw2',
  'qazwsx',
  'a1b2c3',
];

// The bulk of guessed passwords: the core of a password (below) equal to one of these is refused.
// English, Russian, Tajik and transliterated words, pharmacy and local ones (city, country,
// currency, the product's domain).
const COMMON_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passwort',
  'passwd',
  'pass',
  'qwerty',
  'qwertyuiop',
  'qwertz',
  'azerty',
  'asdf',
  'asdfgh',
  'asdfghjkl',
  'zxcv',
  'zxcvbn',
  'zxcvbnm',
  'qazwsx',
  'qwe',
  'qweasd',
  'qweasdzxc',
  'abc',
  'abcd',
  'abcde',
  'abcdef',
  'abcdefg',
  'abcdefgh',
  'admin',
  'administrator',
  'root',
  'user',
  'login',
  'welcome',
  'letmein',
  'iloveyou',
  'love',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'shadow',
  'secret',
  'changeme',
  'default',
  'hello',
  'test',
  'guest',
  'manager',
  'owner',
  'director',
  'direktor',
  'kassa',
  'kassir',
  'privet',
  'parol',
  'lyubov',
  'pharmacy',
  'pharma',
  'apteka',
  'aptekar',
  'dorukhona',
  'doruxona',
  'dorihona',
  'dorikhona',
  'dushanbe',
  'khujand',
  'hujand',
  'tajikistan',
  'tojikiston',
  'tajik',
  'somoni',
  'nurmed',
  'пароль',
  'йцукен',
  'йцукенг',
  'фыва',
  'фывапролдж',
  'ячсмит',
  'админ',
  'администратор',
  'аптека',
  'аптекарь',
  'дорухона',
  'душанбе',
  'худжанд',
  'хуҷанд',
  'таджикистан',
  'тоҷикистон',
  'сомони',
  'касса',
  'кассир',
  'привет',
  'любовь',
  'директор',
  'менеджер',
  'владелец',
  'нурмед',
]);

/**
 * The password starts with a keyboard run, or its core is a common word or one repeated character.
 * The core: NFKC, lower case, without the non-letters around the word, with the look-alike
 * characters replaced (`@4` → a, `0` → o, `1!|` → i, `3` → e, `$5` → s, `7` → t).
 */
export function isCommonPassword(value: string): boolean {
  const lowered = value.normalize('NFKC').toLowerCase();
  if (COMMON_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return true;
  const core = lowered
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    .replace(/[@4]/g, 'a')
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't');
  return COMMON_WORDS.has(core) || /^(.)\1*$/u.test(core);
}
