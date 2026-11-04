# Xunji 前端：Vite 构建 → Nginx 托管并反代 API
# 构建上下文必须是仓库根目录（monorepo）：context: . ，dockerfile: apps/web/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY packages/api ./packages/api
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm run build -w @trovia/web

FROM nginx:1.27-alpine

# 反代目标在容器启动时由 nginx 官方镜像的 envsubst 机制注入。
# compose 里服务名是 api；Northflank 上覆盖为内部服务地址（见 northflank.json）。
ENV API_UPSTREAM=http://api:8000

# .template 后缀是官方镜像约定的扫描入口，启动时渲染到 /etc/nginx/conf.d/
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
