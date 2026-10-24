FROM node:22-bookworm-slim
ARG CODEX_VERSION
RUN test -n "$CODEX_VERSION" && apt-get update && apt-get install -y --no-install-recommends git ca-certificates postgresql libnss-wrapper redis-server poppler-utils tesseract-ocr fonts-liberation && rm -rf /var/lib/apt/lists/* && npm install -g pnpm@10.28.0 @openai/codex@${CODEX_VERSION}
ENV COREPACK_HOME=/opt/corepack
RUN corepack prepare pnpm@10.28.0 --activate && chmod -R a+rX /opt/corepack
WORKDIR /opt/template
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY deploy/agents/sandbox-entrypoint.sh /usr/local/bin/natio-agent-sandbox
RUN chmod 755 /usr/local/bin/natio-agent-sandbox
ENTRYPOINT ["/usr/local/bin/natio-agent-sandbox"]
