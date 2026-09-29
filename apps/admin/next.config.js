//@ts-check

/**
 * Static export (SPA): Next.js runs no server in production (CLAUDE.md).
 * No SSR/ISR, Server Actions, Route Handlers or middleware; data comes only from apps/api.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

module.exports = nextConfig;
