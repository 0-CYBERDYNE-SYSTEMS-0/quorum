# Quorum — production image
# Multi-stage: build the client and server bundle, then run without dev deps.

FROM node:24-alpine AS builder
WORKDIR /app

# Native modules (bcrypt, pg) may need a toolchain at install time.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

RUN addgroup -g 1001 -S quorum && adduser -S quorum -u 1001 -G quorum
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/index.html ./client/index.html
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts

RUN mkdir -p /app/uploads && chown -R quorum:quorum /app

ENV NODE_ENV=production
ENV PORT=5001
EXPOSE 5001

USER quorum
# Apply pending schema changes, then serve. Safe to run on every boot.
CMD ["sh", "-c", "node scripts/migrate.mjs && node dist/index.js"]
