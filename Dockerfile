FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
COPY packages packages
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
RUN npm run build:web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DOUYINJUHE_API_HOST=0.0.0.0 DOUYINJUHE_DATA_DIR=/data
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
COPY packages packages
RUN npm ci --omit=dev --workspace @douyinjuhe/api --no-audit --no-fund
COPY services services
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 18182
CMD ["node", "services/api/src/index.js"]
