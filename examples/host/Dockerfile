# Example image for the multi-host topologies. It runs the TypeScript sources
# directly so the example stays one build step away from the repository.
FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate \
  && mkdir /app /membership && chown node:node /app /membership
# The process never runs as root. The loader writes a transient config file next to the sources.
USER node
WORKDIR /app
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node tsconfig.json vite.config.ts ./
COPY --chown=node:node database ./database
COPY --chown=node:node env ./env
COPY --chown=node:node src ./src
COPY --chown=node:node examples ./examples
# SIGTERM reaches the host process directly so it can drain.
ENTRYPOINT ["node", "node_modules/vite-node/dist/cli.mjs"]
CMD ["examples/host/node.ts"]
