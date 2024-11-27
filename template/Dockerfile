FROM node:20-alpine as frontend-builder
WORKDIR /app
COPY package*.json ./

RUN npm install
# we need to install this manually since the prepare script does not run in docker for reasons beyond my.
# Will be fixed when we move to the npm registry
RUN cd node_modules/reactive-psych && npm install && npm run build

COPY . .
RUN npm run build


FROM node:20-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./
RUN npm run build
RUN npm install -g pm2

COPY --from=frontend-builder /app/dist ./static

EXPOSE 8001

CMD ["npx", "pm2-runtime", "./dist/backend.js"]