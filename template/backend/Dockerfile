FROM node:21-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl bash
COPY . .
RUN npm install
RUN npm run build
RUN npm install pm2 -g

EXPOSE 8000

CMD ["npx", "pm2-runtime", "./dist/server.js"]