# Kortex web (Next.js standalone). Build from the REPOSITORY ROOT:
#   docker build -f apps/web/Dockerfile -t kortex-web \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are build args
# (the anon key is public by design). Every other secret is a runtime env var, never baked in.
# On a hosting platform: base directory "/", Dockerfile location "apps/web/Dockerfile", port 3000,
# health check path /api/health. The complete installation with database is selfhost/README.md.

# --- 1. prune the monorepo to what @kortex/web needs -------------------------------------------
FROM node:22-slim AS pruner
WORKDIR /repo
RUN corepack enable
COPY . .
# Same version as the lockfile (root package.json devDependencies), so the build is repeatable.
RUN npx --yes turbo@2.11.10 prune @kortex/web --docker

# --- 2. install (cached on the lockfile) and build --------------------------------------------
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY --from=pruner /repo/out/json/ .
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# --ignore-scripts: no lefthook prepare hook in the image build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ .
# turbo prune does not carry root-level config files that packages extend
COPY --from=pruner /repo/tsconfig.base.json /repo/eslint.config.mjs ./
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG KORTEX_DATA_SOURCE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    KORTEX_DATA_SOURCE=$KORTEX_DATA_SOURCE \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @kortex/web build

# --- 3. runtime: standalone server only, non-root ----------------------------------------------
FROM node:22-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# curl: hosting platforms run their health check (curl/wget) INSIDE the container; node:22-slim has neither
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
