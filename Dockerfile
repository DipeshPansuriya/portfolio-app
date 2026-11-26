# One image for the web app and the API (ADR 0004). Build it with `sh scripts/ci.sh 6`.
# No "# syntax=" line: it would pull a second image just to read this file.

# Node 26.13.1 on Alpine, pinned by digest.
ARG NODE_IMAGE=node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

FROM ${NODE_IMAGE} AS base
WORKDIR /app

# npm download cache. Empty by default; an offline build replaces it:
#   --build-context npmcache=<dir> --build-arg NPM_FLAGS=--offline
FROM scratch AS npmcache

# Runtime packages only: `pg` and what it needs.
FROM base AS deps
ARG NPM_FLAGS=
COPY package.json package-lock.json ./
RUN --mount=type=bind,from=npmcache,source=/,target=/npm-cache,rw \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache /npm-cache $NPM_FLAGS

# Web build: the browser files and the hero shell bundle.
FROM base AS webbuild
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# Only the build output. An offline build replaces this whole stage with a folder
# holding `dist/` and `dist-server/` (--build-context web=<dir>).
FROM scratch AS web
COPY --from=webbuild /app/dist /dist
COPY --from=webbuild /app/dist-server /dist-server

# The application tree, assembled and made read-only for the runtime user.
FROM base AS app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY content ./content
COPY scripts/reset-password.mjs scripts/db-check.mjs ./scripts/
COPY --from=web /dist ./dist
COPY --from=web /dist-server ./dist-server
# Source files may be owner-only on the build machine; the runtime user only reads.
RUN chmod -R u=rwX,go=rX /app

# The base filesystem without what only a build needs: npm, npx, the C headers, the apk
# program. /lib/apk/db stays: the vulnerability scan reads the package list from it.
FROM base AS trimmed
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/include/node /sbin/apk /usr/lib/libapk.so* /var/cache/apk/*

# Copied into an empty image, not built on top of the base image: what was removed above
# is in no layer. The base image's settings are therefore declared again here.
FROM scratch AS runtime
# hadolint ignore=DL3067
COPY --from=trimmed / /
COPY --from=app /app /app
ARG NODE_IMAGE
ARG VERSION=0.0.0
ARG REVISION=unknown
ARG SOURCE=unpublished
LABEL org.opencontainers.image.title="portfolio" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.base.name="${NODE_IMAGE}"
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_ENV=production HOST=0.0.0.0 PORT=4319
WORKDIR /app
USER 1000:1000
EXPOSE 4319
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 4319}/api/ready`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
