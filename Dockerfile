# syntax=docker/dockerfile:1

# ---- Build stage: install all deps and bundle to dist/ ----
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts skips the Husky "prepare" hook (no .git in the image).
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

# ---- Runtime stage: production deps + bundle only ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && pnpm store prune
COPY --from=build /app/dist ./dist

# Cloud Run injects PORT (defaults to 8080); the server reads process.env.PORT
# and binds 0.0.0.0 by default.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
