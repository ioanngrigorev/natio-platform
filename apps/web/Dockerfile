# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @natio/web... --frozen-lockfile || pnpm install --filter @natio/web...
COPY apps/web apps/web
# NEXT_PUBLIC_* values are inlined at build time.
ARG NEXT_PUBLIC_API_URL=https://api.natio.me
ARG NEXT_PUBLIC_SITE_URL=https://natio.me
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NODE_ENV=production
RUN pnpm --filter @natio/web run build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini curl && addgroup -g 1001 natio && adduser -u 1001 -G natio -s /bin/sh -D natio
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

# Next.js standalone output ships its own minimal node_modules.
COPY --from=build --chown=natio:natio /repo/apps/web/.next/standalone ./
COPY --from=build --chown=natio:natio /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=natio:natio /repo/apps/web/public ./apps/web/public

USER natio
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
