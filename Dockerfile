FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


FROM node:20-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.api.json ./
COPY src ./src
COPY api ./api

RUN npm run build
RUN npm run api:build
RUN npm prune --omit=dev


FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-api ./dist-api

CMD ["npm", "run", "pm2:runtime"]
