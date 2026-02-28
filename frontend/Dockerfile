FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY . .
RUN bun run build

# -----------------
# Production stage
# -----------------
FROM oven/bun:1-alpine

WORKDIR /app

# Install 'serve' globally
RUN bun install -g serve

COPY --from=build /app/dist ./dist
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 4173

ENTRYPOINT ["./entrypoint.sh"]
