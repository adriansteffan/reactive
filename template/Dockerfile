FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY . .
RUN bun run build:production


FROM oven/bun:1-distroless
WORKDIR /app

COPY --from=build /app/dist/server ./
COPY --from=build /app/public ./public

EXPOSE 8001

# The image's entrypoint is bun
CMD ["server.js"]
