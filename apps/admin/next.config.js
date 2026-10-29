//@ts-check

/**
 * Static export (SPA): Next.js runs no server in production (CLAUDE.md).
 * No SSR/ISR, Server Actions, Route Handlers or middleware; data comes only from apps/api.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // Always defined so the bundler can fold mock-only code away; the dev target sets it to true.
  env: {
    NEXT_PUBLIC_API_MOCKS: process.env.NEXT_PUBLIC_API_MOCKS ?? 'false',
    // The public site for «Открыть на сайте» (ADR-0023, W15): SITE_ORIGIN of `.env` in dev, the build arg of
    // the proxy image; empty — the link is hidden.
    NEXT_PUBLIC_SITE_ORIGIN:
      process.env.NEXT_PUBLIC_SITE_ORIGIN ?? process.env.SITE_ORIGIN ?? '',
  },
};

// Dev only: proxy /api/* to apps/api so the browser sees a single origin (as behind the
// reverse proxy in production, C4 deployment). `rewrites` are not part of the static export.
if (process.env.NODE_ENV === 'development') {
  const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';
  nextConfig.rewrites = async () => [
    { source: '/api/:path*', destination: `${target}/api/:path*` },
  ];
}

module.exports = nextConfig;
