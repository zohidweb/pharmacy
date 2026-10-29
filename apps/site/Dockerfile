# syntax=docker/dockerfile:1
# apps/site — public site image (ADR-0023): the standalone server of Next.js, ISR by time. Build context: repository
# root.
#   docker build -f apps/site/Dockerfile -t pharmacy/site .

# Pinned by version + digest for reproducible builds; update deliberately (ADR-0005: base image updates).
# NODE_IMAGE is the one of apps/api/Dockerfile.
ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
ENV NX_DAEMON=false NX_NO_CLOUD=true NX_SKIP_NX_CACHE=true CI=true NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci --no-audit --no-fund
# Declarations of the libs first: the type check of next build reads them from libs/*/dist (TS project references),
# and the build context carries no dist (as in docker/proxy/Dockerfile). The build never calls the API: no page is
# prerendered (spec 5).
RUN npx nx run-many -t typecheck -p ui shared-dto shared-util shared-domain --outputStyle=static \
  && NODE_ENV=production npx nx build site --outputStyle=static

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# The standalone output keeps the monorepo layout (outputFileTracingRoot): the server is apps/site/server.js with the
# traced node_modules at /app; the static files and public/ are not part of it and are copied next to the server.
# The code stays root-owned: the runtime user `node` reads it and cannot rewrite it; source maps and the package
# managers of the base image (npm, corepack, yarn) are not shipped (security review 2026-10-22, S3 — compose runs the
# container read-only; the ISR cache lives in the memory of Next, W16, and .next/cache is a tmpfs safety net).
COPY --from=build /workspace/apps/site/.next/standalone ./
COPY --from=build /workspace/apps/site/.next/static ./apps/site/.next/static
COPY --from=build /workspace/apps/site/public ./apps/site/public
RUN find /app -name '*.map' -type f -delete \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
# HOSTNAME: Docker sets it to the container id, and the standalone server would listen on that address only.
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
USER node
EXPOSE 3000
# robots.txt is rendered per request without the API: the site process answers, whatever the API does.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/site/server.js"]
