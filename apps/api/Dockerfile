# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @natio/api... --frozen-lockfile || pnpm install --filter @natio/api...
COPY apps/api apps/api
RUN pnpm --filter @natio/api run build

# Prune to production dependencies only.
# pnpm 10 refuses a non-injected workspace deploy without --legacy; verified against this workspace.
RUN pnpm --filter @natio/api --prod deploy --legacy /out

# ---------- runtime ----------
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini curl && addgroup -g 1001 natio && adduser -u 1001 -G natio -s /bin/sh -D natio
WORKDIR /app
# Stamped by the deploy so /health can report which commit is serving.
ARG NATIO_GIT_SHA=unknown
ENV NATIO_GIT_SHA=$NATIO_GIT_SHA
ENV NODE_ENV=production

COPY --from=build --chown=natio:natio /out/node_modules ./node_modules
COPY --from=build --chown=natio:natio /repo/apps/api/dist ./dist
COPY --from=build --chown=natio:natio /repo/apps/api/package.json ./package.json
# Migrations and the OpenAPI document are read at runtime.
COPY --from=build --chown=natio:natio /repo/apps/api/src/db/migrations ./dist/db/migrations
COPY --from=build --chown=natio:natio /repo/apps/api/openapi ./openapi

USER natio
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
