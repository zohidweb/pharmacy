//@ts-check
const path = require('node:path');

/**
 * Public site (ADR-0023): Next.js with server rendering (`next start` of the standalone output) and
 * time-based ISR. No Server Actions, middleware/proxy or Route Handlers other than the metadata routes;
 * data comes only from the public API `/api/v1/public/*`.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'standalone',
  // the monorepo root: the standalone output traces libs/* and the hoisted node_modules from there
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // no next/image optimizer: it needs sharp, a new dependency (ADR-0023)
  images: { unoptimized: true },
  poweredByHeader: false,
  // Russian has no prefix, Tajik lives under /tg (spec 6.1). `/ru/...` addresses would duplicate the
  // Russian pages for search engines: they move to the address without the prefix.
  redirects: async () => [
    { source: '/ru', destination: '/', permanent: true },
    { source: '/ru/:path*', destination: '/:path*', permanent: true },
  ],
  rewrites: async () => ({
    beforeFiles: [
      // dev only: the browser sees the public API on the site's origin, as behind Caddy in test/prod
      ...(process.env.NODE_ENV === 'development'
        ? [
            {
              source: '/api/v1/public/:path*',
              destination: `${process.env.API_PROXY_TARGET ?? 'http://localhost:3000'}/api/v1/public/:path*`,
            },
          ]
        : []),
      { source: '/', destination: '/ru' },
      // every other address without a language segment is a Russian page (app/[locale]/...)
      {
        source:
          '/:path((?!tg(?:/|$)|ru(?:/|$)|_next/|api/|robots\\.txt$|sitemap\\.xml$).+)',
        destination: '/ru/:path',
      },
    ],
    afterFiles: [],
    fallback: [],
  }),
};

module.exports = nextConfig;
