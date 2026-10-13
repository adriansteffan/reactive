FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY . .
RUN bun run build


FROM oven/bun:1-alpine
WORKDIR /app

COPY --from=build /app/dist-server ./
COPY --from=build /app/public ./public

ENV NODE_ENV=production
EXPOSE 8001

CMD ["bun", "server.js"]
