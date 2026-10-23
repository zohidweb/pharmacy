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

/** The look-alike characters of a word as letters; `1` may stand for `i` or for `l`. */
const asLetters = (word: string, one: 'i' | 'l'): string =>
  word
    .replace(/[@4]/g, 'a')
    .replace(/0/g, 'o')
    .replace(/1/g, one)
    .replace(/[!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't');

const NOT_LETTERS_AROUND = /^[^\p{L}]+|[^\p{L}]+$/gu;

/**
 * The password starts with a keyboard run, or its core is a common word or one character repeated
 * three times or more. The core: NFKC and lower case, look-alike characters read as letters
 * (`@4` → a, `0` → o, `1` → i or l, `!|` → i, `3` → e, `$5` → s, `7` → t), the non-letters around
 * the word dropped — the digits and symbols after the word are dropped before the look-alikes are
 * read too, so `4dmin2024` and `$ecret!` are cores `admin` and `secret`.
 */
export function isCommonPassword(value: string): boolean {
  const lowered = value.normalize('NFKC').toLowerCase();
  if (COMMON_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return true;
  const word = lowered.replace(/[^\p{L}]+$/u, '');
  const cores = (['i', 'l'] as const).flatMap((one) =>
    [word, lowered].map((text) =>
      asLetters(text, one).replace(NOT_LETTERS_AROUND, ''),
    ),
  );
  return cores.some(
    (core) =>
      COMMON_WORDS.has(core) || (core.length >= 3 && /^(.)\1*$/u.test(core)),
  );
}
