# syntax=docker/dockerfile:1
# Reverse proxy (ADR-0012): Caddy with the static exports of apps/web and apps/admin baked in.
# Build context: repository root.
#   docker build -f docker/proxy/Dockerfile -t pharmacy/proxy .

# Pinned by version + digest; update deliberately (ADR-0005: base image updates).
# NODE_IMAGE is the one of apps/api/Dockerfile.
ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ARG CADDY_IMAGE=caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
ENV NX_DAEMON=false NX_NO_CLOUD=true NX_SKIP_NX_CACHE=true CI=true NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci --no-audit --no-fund
# Declarations of the libs first: the type check of next build reads them from libs/*/dist (TS project references),
# and the build context carries no dist. Then the static exports of both frontends against the real API, .br/.gz next
# to them, maps removed. Never with the API mocks (security review 2026-10-22, F1): the flag is pinned off, and an
# export that still carries them stops the build.
RUN npx nx run-many -t typecheck -p ui shared-dto shared-util shared-domain --outputStyle=static \
  && NODE_ENV=production NEXT_PUBLIC_API_MOCKS=false npx nx run-many -t build -p web admin --outputStyle=static \
  && node -e "import('./tools/scripts/frontend-mocks.mjs').then(({ frontendBuildProblem }) => { \
       const problem = frontendBuildProblem('.'); if (problem) { console.error(problem); process.exit(1); } })" \
  && node tools/scripts/precompress.mjs apps/web/out apps/admin/out

FROM ${CADDY_IMAGE} AS runtime
COPY docker/proxy/Caddyfile /etc/caddy/Caddyfile
COPY docker/proxy/profiles/ /etc/caddy/profiles/
COPY --from=build /workspace/apps/web/out /srv/web
COPY --from=build /workspace/apps/admin/out /srv/admin
# Internal health listener of the Caddyfile; never published.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8081/healthz || exit 1
