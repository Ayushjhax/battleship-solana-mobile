# Match server image. Runs the TypeScript source directly via tsx — no
# separate build step, since tsx (an esbuild-based loader) is a runtime
# dependency, not a devDependency.
#
# IMPORTANT: the build context must be the REPO ROOT (my-app/), not server/,
# because the server imports the shared engine from ../src/engine outside
# this directory (see server/tsconfig.json's `@engine/*` path alias — tsx
# resolves it the same way at runtime). Build locally with:
#
#   docker build -f server/Dockerfile -t seabattle-server .
#
# On Render: render.yaml at the repo root already points here
# (dockerfilePath: ./server/Dockerfile, dockerContext: .) — see README.md's
# "Deploying the match server" section for the dashboard walkthrough.

FROM node:22-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# The shared engine, imported as @engine/* — must never be reimplemented,
# only copied in verbatim from the same source the Expo app builds against.
COPY src/engine ./src/engine
COPY src/net/database.types.ts ./src/net/database.types.ts

WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

USER node
CMD ["node_modules/.bin/tsx", "src/index.ts"]
