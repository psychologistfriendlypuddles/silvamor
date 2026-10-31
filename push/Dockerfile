# Silvamor push service. Build from the repository root:
#   docker build --pull -f push/Dockerfile -t silvamor-push .
# node:24-alpine on purpose, not pinned: --pull fetches its newest release on every build, so
# rebuilding brings Node and Alpine fixes.
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run push:build

# The service is one bundled file; it needs nothing but Node.
FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/push/dist/server.mjs ./
ENV PORT=8787 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]
