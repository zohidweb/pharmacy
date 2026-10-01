# Third-party notices — libs/ui

Material copied into the UI kit (no npm dependency, nothing loaded from a CDN at runtime).

## Lucide icons — ISC License

- Source: `lucide-static` 1.49.0 (https://lucide.dev), SVG geometry copied into
  `src/lib/icon/icons.ts` (ADR-0007, п. 6). Icon names are kept 1:1 with Lucide.
- Copyright (c) 2026 Lucide Icons and Contributors (ISC). Icons derived from Feather —
  Copyright (c) 2013-present Cole Bemis (MIT). Full license texts: `assets/LICENSE-lucide.txt`.

> Permission to use, copy, modify, and/or distribute this software for any purpose with or
> without fee is hereby granted, provided that the above copyright notice and this permission
> notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
> SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
> AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
> NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.

## TT Norms Pro — commercial font (TypeType)

- Files: `assets/fonts/TTNormsPro-{Regular,Medium,Bold}.otf`, wired in `src/styles/fonts.css`.
- **License status: not confirmed for this product.** The files come from a design system of
  another organization's product; a web-font license from TypeType covering this SaaS
  (distribution to every tenant's browser, cloud and offline stores) must be confirmed
  before release. Until then the font is replaceable in one place (`fonts.css`,
  `--ph-font-face-sans`).
