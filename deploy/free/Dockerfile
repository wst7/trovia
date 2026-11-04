# 全栈单容器镜像：API + Worker + 前端页面，对外只有一个端口。
#
# 面向免费 PaaS（Render / Koyeb 等）：这类平台通常只给一个 Web 服务，
# 没有单独放 Nginx 和 Background Worker 的位置，所以这里把三件事合成一个镜像：
#   · uvicorn 提供 /api/v1（以及 /api/docs）
#   · 同一容器里的 worker 子进程负责领取并解析任务
#   · FastAPI 顺带托管 apps/web 的构建产物（XUNJI_WEB_DIR）
# 数据库不在这里：用外部免费 PostgreSQL（需要 vector / pg_trgm / pgcrypto）。
#
# 构建上下文必须是仓库根目录：
#   docker build -f deploy/free/Dockerfile -t trovia-free .

FROM node:20-alpine AS web
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY packages/api ./packages/api
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm run build -w @trovia/web

FROM python:3.12-slim

# 国内构建可传 --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/pyproject.toml ./pyproject.toml
COPY backend/app ./app
COPY backend/migrations ./migrations
RUN pip install --no-cache-dir .

COPY --from=web /repo/apps/web/dist ./web
COPY backend/start-all-in-one.sh ./start.sh
RUN chmod +x ./start.sh

# FastAPI 直接发页面；平台会通过 PORT 覆盖监听端口。
ENV XUNJI_WEB_DIR=/app/web \
    PORT=8000
EXPOSE 8000

CMD ["/app/start.sh"]
