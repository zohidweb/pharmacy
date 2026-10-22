# syntax=docker/dockerfile:1
# apps/api — NestJS API image (ADR-0005). Build context: repository root.
#   docker build -f apps/api/Dockerfile -t pharmacy/api .

# Pinned by version + digest for reproducible builds; update deliberately (ADR-0005: base image updates).
ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
ENV NX_DAEMON=false NX_NO_CLOUD=true NX_SKIP_NX_CACHE=true CI=true
COPY . .
RUN npm ci --no-audit --no-fund
# Builds the app and writes a pruned package.json + package-lock.json (+ workspace libs) to apps/api/dist
RUN npx nx run api:prune --configuration=production

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The code stays root-owned: the runtime user `node` reads it and cannot rewrite it; the source map and the package
# managers of the base image (npm, corepack, yarn) are not shipped (security review 2026-10-22, S3 — compose runs the
# container read-only as well).
COPY --from=build /workspace/apps/api/dist ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
  && rm -f main.js.map \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
