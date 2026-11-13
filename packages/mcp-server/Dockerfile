# Kortex MCP server (remote mode: OAuth 2.1 for claude.ai custom connectors).
#
# Build from the REPOSITORY ROOT (the workspace packages @kortex/db and @kortex/ai-core are bundled in):
#   docker build -f packages/mcp-server/Dockerfile -t kortex-mcp .
# On a hosting platform: base directory "/", Dockerfile location "packages/mcp-server/Dockerfile",
# port 3333, health check path /healthz. Configuration is environment only, see REMOTE.md next to this file.

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# --ignore-scripts: no lefthook/husky style prepare hooks in the image build
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@kortex/mcp-server..." \
 && pnpm --filter @kortex/mcp-server build

FROM node:22-slim
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3333
WORKDIR /app
# one self-contained file: SDK, Supabase client and ai-core are bundled
COPY --from=build /repo/packages/mcp-server/dist/cli.mjs ./cli.mjs
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||3333)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "cli.mjs", "--http"]
