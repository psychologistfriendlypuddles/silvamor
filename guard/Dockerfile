# Silvamor relay guard. Build from the repository root:
#   docker build -f guard/Dockerfile -t silvamor-guard .
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run guard:build

# The guard is one bundled file; it needs nothing but Node.
FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/guard/dist/server.mjs ./
ENV LISTEN=0.0.0.0:50051
EXPOSE 50051
# Healthy while the guard answers admission requests (a real round trip, not just an open port).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "server.mjs", "--health"]
CMD ["node", "server.mjs"]
