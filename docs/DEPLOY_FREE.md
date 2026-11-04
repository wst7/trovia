# 免费部署（一个容器跑完整应用）

> **现状：Web 部署已暂停。** 主产品是本地优先的手机 App（`apps/mobile`），它不需要后端。
> 本文保留为自托管 Web / API 的参考，不再随版本发布。

目标：**$0 跑起来**，不改业务代码。做法是把三件事塞进同一个容器——

- `uvicorn` 提供 `/api/v1`
- 同一个容器里的 worker 子进程领取解析任务
- FastAPI 顺带托管 `apps/web` 的构建产物（`XUNJI_WEB_DIR`）

前端和接口同源，所以不需要 Nginx、不需要 CORS。数据库用外部免费 PostgreSQL。

| 部分 | 用谁 | 免费额度 |
|---|---|---|
| 应用 + API + Worker | Render 免费 Web 服务（Docker） | 512 MB 内存；15 分钟无访问休眠；每月实例小时有上限 |
| 数据库 | Supabase 免费 PostgreSQL（含 `pgvector`） | 500 MB；长时间无活动会被暂停 |
| 说明页（可选） | Cloudflare Pages | 静态站点免费 |
| Android APK | GitHub Actions | 公共仓库免费 |

> 免费额度这两年一直在收紧，我这边没法联网核对当前价目页。注册前看一眼 Render 的 pricing；如果免费 Web 服务已经取消，本仓库的镜像可以原样放到 Koyeb 的免费实例上（见文末「换平台」），不用改代码。

## 为什么必须合成一个容器

免费档基本都**不提供 Background Worker**，也不给第二个常驻服务。而保存链接后必须有进程一直领取并解析任务，否则页面永远停在「等待整理」。所以 `backend/start-all-in-one.sh` 同时起 API 和 Worker，`deploy/free/Dockerfile` 把前端构建产物一起打进去。

拆开跑的老方式（`docker-compose.yml`、Northflank 模板）不受影响：这是**多出来的一种部署形态**，不是替换。

## 第 1 步：建免费数据库（Supabase）

1. 新建项目，区域选 **Southeast Asia (Singapore)** 或 **Northeast Asia (Tokyo)**。
2. 进 SQL Editor，先手动建扩展（迁移里也会 `CREATE EXTENSION IF NOT EXISTS`，这一步只是把错误提前暴露）：

   ```sql
   create extension if not exists vector;
   create extension if not exists pg_trgm;
   create extension if not exists pgcrypto;
   ```

3. Project Settings → Database → **Connection string** → 选 **Session pooler**（端口 5432）。
   **不要用 Direct connection**：它是 IPv6-only，很多 PaaS 的出站网络没有 IPv6，表现就是连接超时。
4. 把 `[YOUR-PASSWORD]` 换成真实密码（有特殊字符要做 URL 编码），得到形如：

   ```text
   postgresql://postgres.abcdefgh:密码@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

   直接以 `postgresql://` 开头就行——后端会把驱动补成 `psycopg3`，也会关掉预处理语句以适配连接池。

## 第 2 步：部署到 Render

仓库根目录的 `render.yaml` 已经把服务、镜像路径、健康检查和环境变量写好了。

1. Render → **New** → **Blueprint** → 选这个仓库 → 它会读到 `render.yaml`。
   也可以直接打开一键链接：<https://render.com/deploy?repo=https://github.com/wst7/trovia>（登录后即进入同一流程）。
2. 唯一需要你填的是 `DATABASE_URL`（粘贴第 1 步的连接串）。
3. Apply，等首次构建（`npm ci` + 前端构建 + `pip install`，约 5–10 分钟）。

不想用 Blueprint 就手动建：New → Web Service → Docker →
Dockerfile Path `./deploy/free/Dockerfile`、Docker Context `.`、Plan 选 Free、
Health Check Path `/api/v1/health`，环境变量照抄 `render.yaml`。

`APP_SECRET` 用 Blueprint 时会自动生成；手动建时随便填一串长随机值即可（当前代码没有用到它，留着是为了以后加签名）。

部署完成后打开 `https://<服务名>.onrender.com`，应该直接看到注册页。
首次访问如果等了半分钟才出来，是免费实例冷启动，正常。

## 第 3 步：手机 App 指向它

GitHub → Settings → Secrets and variables → Actions → **Variables** → 新建
`XUNJI_API_BASE_URL`，值为 `https://<服务名>.onrender.com/api/v1`。
然后 Actions → **Android APK** → Re-run workflow，产物在该次运行页的 Artifacts 里。

## 第 4 步（可选）：说明页

Cloudflare Pages 连同一个仓库：

- 构建命令：`npm run build -w @trovia/landing`
- 输出目录：`apps/landing/dist`
- 环境变量：`XUNJI_APP_URL=https://<服务名>.onrender.com`

域名在部署后是固定的，所以这里用构建期注入即可，不需要 `XUNJI_RUNTIME_URLS`。

## 会用到的环境变量

| 变量 | 值 | 说明 |
|---|---|---|
| `DATABASE_URL` | Supabase session pooler 串 | **必填** |
| `APP_SECRET` | 随机长串 | 当前未使用，占位 |
| `AI_PROVIDER` | `extractive` | 离线摘要，不需要密钥 |
| `EMBEDDING_PROVIDER` | `local` | 离线向量 |
| `EMBEDDING_DIM` | `1536` | 必须与 provider 实际维度一致 |
| `WORKER_POLL_SECONDS` | `15` | 免费库降低轮询频率；保存后最多等这么久开始解析 |
| `XUNJI_WEB_DIR` | `/app/web` | 镜像里已内置，一般不用改 |

接真实模型时再加 `AI_*` / `EMBEDDING_*`，密钥只放平台的环境变量里，不要提交。

## 这套方案的实际限制

- **冷启动**：15 分钟没人访问就休眠，下次访问 30–60 秒。休眠期间 Worker 也停着，任务留在库里，醒来继续。
- **512 MB 内存**：正常单用户使用够；解析超大页面时可能紧张。
- **数据库 500 MB**：摘要 + 正文 + 向量，够存几千篇；满了要清或升级。
- **单实例**：不存在并发扩容，也不需要。
- **公网可达 = 注册接口可达**：后端目前没有限流。只给自己用就尽量别传播地址；认真对外前先补 `/auth/*` 限流。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 部署失败在 health check，日志连不上数据库 | `DATABASE_URL` 写错 / 用了 Direct connection（IPv6） | 改用 Session pooler 串；密码有特殊字符要 URL 编码 |
| 启动报 `function similarity(...) does not exist` 或找不到 `vector` 类型 | 扩展装在 `extensions` schema，`search_path` 没包含 | 在 Supabase SQL Editor 执行 `alter database postgres set search_path = "$user", public, extensions;`，然后重新部署 |
| 页面能开，接口全 404 | 访问路径少了 `/api/v1`，或把 `XUNJI_WEB_DIR` 指到了错误的目录 | `/api/v1/health` 应返回 `{"status":"ok"}` |
| 保存后一直 `pending` | worker 没起来（例如平台只跑了 CMD 的一部分） | 日志里应有 `worker_started`；本方案的启动命令是 `/app/start.sh` |
| 每次打开都等半分钟 | 免费实例休眠 | 正常现象；介意就换常在线方案 |
| 日志里 `web_dir_missing` | `XUNJI_WEB_DIR` 指向的目录没有 `index.html` | 用仓库自带镜像时保持默认 `/app/web` |

## 换平台：镜像本身是通用的

任何"给一个容器、注入 `PORT`"的平台都能跑这个镜像：

```bash
docker build -f deploy/free/Dockerfile -t xunji .
docker run -p 8000:8000 -e DATABASE_URL='postgresql://…' -e XUNJI_WEB_DIR=/app/web xunji
```

- **Koyeb**：免费 Web 服务，同样是一个容器一个端口，配置项与 Render 基本一致。
- **自己的机器**：上面两条命令即可；想给手机用再加 `cloudflared tunnel` 拿 HTTPS 域名。
- **Oracle Cloud 永久免费 VM**：4 核 / 24 GB，全天在线无冷启动；用 `docker-compose.yml` 原样跑（含自带数据库），再套一层 Caddy 拿证书。

## 和 Northflank 方案的关系

`northflank.json` 那套是**付费但完整**的形态：数据库、API、Worker 分开跑，Web 用 Nginx，
没有冷启动。两套共用同一份代码与镜像入口，按预算选一套即可，不要同时部署（会重复计费）。
