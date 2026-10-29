/** The longest slug the API takes (`SaveArticleDto.slug`). */
export const SLUG_MAX = 120;

/** The pattern of the API for a slug of an article. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Russian and Tajik letters → Latin. The soft and the hard sign are skipped.
const letters: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  ӣ: 'i',
  й: 'y',
  к: 'k',
  қ: 'q',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ӯ: 'u',
  ф: 'f',
  х: 'kh',
  ҳ: 'h',
  ц: 'ts',
  ч: 'ch',
  ҷ: 'j',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * The address of an article from its title: transliteration of Russian and Tajik letters, Latin letters and
 * digits stay, everything else is a hyphen (repeats merged, none at the ends), at most 120 characters. The
 * result fits `SLUG_PATTERN`, or is `''` when the title has no letters or digits.
 */
export function slugify(title: string): string {
  let result = '';
  for (const char of title.toLowerCase().normalize('NFC')) {
    const mapped = letters[char];
    if (mapped !== undefined) result += mapped;
    else if (/^[a-z0-9]$/.test(char)) result += char;
    else result += '-';
  }
  return result
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-$/, '');
}
