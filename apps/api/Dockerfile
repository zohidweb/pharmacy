# syntax=docker/dockerfile:1
# apps/api — NestJS API image (ADR-0005). Build context: repository root.
#   docker build -f apps/api/Dockerfile -t pharmacy/api .

ARG NODE_IMAGE=node:24-alpine

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
COPY --from=build --chown=node:node /workspace/apps/api/dist ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
