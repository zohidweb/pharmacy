/**
 * The size of a large money figure: the price of a store on the green panels of the home page and of /tariffs
 * (amendment 2026-11-02-public-site-light-panels 4.4, п. 7). `formatMoney` binds the figure with no-break spaces, so it
 * never wraps and its size is the only thing that keeps it inside the panel. Both callers drop zero dirams (spec
 * 2026-11-04-public-site-home-polish, H4). Up to 8 characters («400 с», «1 400 с», «412,50 с», «12 400 с») it takes the
 * figure size (56 px, 96 px from 1024 px); a longer one («112 400 с», «1 412,50 с») the display size (36 px, 56 px from
 * 1024 px), which fits the narrowest panel (/tariffs at 320 px) and a half of the home panel at 1024 px.
 */
export function figureClassName(text: string): string {
  return text.length <= 8
    ? 'text-site-figure-sm md:text-site-figure'
    : 'text-display-sm md:text-display';
}
