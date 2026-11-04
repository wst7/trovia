# Xunji 说明页（静态站点）：构建上下文必须是仓库根目录
FROM node:20-alpine AS build
WORKDIR /app

# 应用地址与站点自身的公开地址默认在构建时注入（og:image 需要绝对 URL）。
# 托管平台的域名要等部署完成才生成，所以 hosted 构建置 XUNJI_RUNTIME_URLS=1
# 保留 __APP_URL__ / __SITE_URL__ 占位符，改由容器启动脚本替换。
ARG XUNJI_APP_URL=http://localhost:3000
ARG XUNJI_SITE_URL=http://localhost:3001
ARG XUNJI_RUNTIME_URLS=0
ENV XUNJI_APP_URL=${XUNJI_APP_URL}
ENV XUNJI_SITE_URL=${XUNJI_SITE_URL}
ENV XUNJI_RUNTIME_URLS=${XUNJI_RUNTIME_URLS}

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/landing/package.json apps/landing/
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY apps/landing ./apps/landing
RUN npm run build -w @trovia/landing

FROM nginx:1.27-alpine
# 运行时地址注入：官方镜像会在启动时执行 /docker-entrypoint.d/ 下的可执行脚本
COPY apps/landing/docker-entrypoint.d/40-trovia-urls.sh /docker-entrypoint.d/40-trovia-urls.sh
RUN chmod +x /docker-entrypoint.d/40-trovia-urls.sh
COPY --from=build /app/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
