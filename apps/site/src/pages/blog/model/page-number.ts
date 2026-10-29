import { ARTICLES_PER_PAGE } from '@/shared/api';

/** The largest `offset` the public API accepts. */
const MAX_OFFSET = 100_000;

/**
 * `?page=N` of the blog (W7): absent — the first page; anything but a positive whole number (or a page past
 * what the API can list) — `null`, a 404. A page past the last one is checked against `total` by the page.
 */
export function blogPageNumber(
  raw: string | string[] | undefined,
): number | null {
  if (raw === undefined) return 1;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,5}$/.test(raw)) return null;
  const page = Number(raw);
  return (page - 1) * ARTICLES_PER_PAGE <= MAX_OFFSET ? page : null;
}

/** The address of a page of the blog without the language prefix; the first one has no `?page`. */
export function blogPagePath(page: number): string {
  return page === 1 ? '/blog' : `/blog?page=${page}`;
}
