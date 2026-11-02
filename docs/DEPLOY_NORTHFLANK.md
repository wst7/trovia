# 部署到 Northflank（从 GitHub 构建）

> **现状：Web 部署已暂停。** 主产品是本地优先的手机 App（`apps/mobile`），它不需要后端。
> 本文保留为自托管 Web / API 的参考，模板仍可用于自己部署。

仓库根目录的 [`northflank.json`](../northflank.json) 是一份 Northflank 模板（`apiVersion: v1.2`）。跑一次就能建出项目、PostgreSQL、后端镜像构建服务、API、Worker 和 Web 前端，不需要逐项点界面。

模板只声明**结构**；密钥在读入时生成（`${fn.randomSecret(64)}`）或由数据库 addon 注入，不写进仓库。

## 模板创建的资源

| ref | 资源 | 规格 | 说明 |
|---|---|---|---|
| `project` | 项目 `Xunji` | 区域 `asia-east`（香港） | 入口流量仅限本项目 |
| `db` | PostgreSQL **16** addon `xunji-db` | `nf-compute-50` + 6 GB 卷 | 只开内部访问，不开公网 |
| `backend` | BuildService `xunji-backend` | 构建计划 `nf-compute-400-16` | 构建上下文 `/backend`，Dockerfile `/backend/Dockerfile` |
| `env` | SecretGroup `xunji-env` | — | `APP_SECRET`、离线 AI 默认值；`DATABASE_URL` = addon 的 `POSTGRES_URI` 别名 |
| `api` | DeploymentService `xunji-api` | `nf-compute-50`（0.5 vCPU / 1 GB） | 容器端口 8000，**私有**，不占公网域名 |
| `worker` | DeploymentService `xunji-worker` | `nf-compute-50` | 同一镜像，启动命令 `python -m app.workers.runner`，无端口 |
| `web` | CombinedService `xunji-web` | `nf-compute-20`（0.2 vCPU / 512 MB） | 容器端口 80，**公开**；Nginx 托管前端并把 `/api/` 反代到 `http://xunji-api:8000` |

费用（Northflank 公开价，美元）：API 12 + Worker 12 + Web 5.4 ≈ **每月 29.4**，另加数据库的 `nf-compute-50`（12/月）和 6 GB 卷。构建计划 `nf-compute-400-16` 只在构建时按分钟计费，空闲不计。

`xunji-api` 不开放公网端口：浏览器只访问 `xunji-web`，由 Nginx 反代到内部服务，所以前端和 API 同源，不需要 CORS，也不需要单独给 API 配域名。

## 前置条件

1. GitHub 仓库 `https://github.com/wst7/trovia` 存在、分支为 `main`，且 Northflank 能读取它（公开仓库，或在该账号内链接 GitHub 集成并授权。
   **从模板创建的构建服务使用 Northflank 账号里已链接的 GitHub 凭据**）。
2. 代码已推送。`northflank.json`、`backend/`、`apps/web/` 都在同一个 commit 里。
3. 仓库里没有 `.env`（`.gitignore` 与 `.dockerignore` 都已排除）。

## 导入并运行模板

1. Northflank → **Templates** → 新建模板。
2. 打开 JSON / 代码视图，把 `northflank.json` 的全部内容粘贴进去。
   根对象只允许 `apiVersion` 和 `spec`；节点放在 `spec.spec.steps` 里。
   Northflank 会先 dry-run 一遍所有 `${refs.*}` / `${args.*}` / `${fn.*}`，引用解析不了会直接报错，此时**不会有任何资源被创建**。
3. 运行模板，按顺序会看到：项目 → 数据库 → 构建服务 → 触发构建 → 并行等待「数据库 running」与「构建成功」→ 密钥组 → API → Worker → Web。

等待构建时不要关页面：API 和 Worker 都依赖那次构建产出的镜像（`buildId`）。构建失败时后面三个节点不会执行，改完代码重新运行模板即可。

如果想用 GitOps 让模板跟随仓库，也可在模板设置里关联同一个仓库和 `northflank.json`；文件位置由 Northflank 侧指定，本仓库只保证这份文件是合法模板。

## 部署后必须确认的 4 件事

1. **公开域名**。Services → `xunji-web` → Ports → 复制域名，形如
   `https://http--xunji-web--<随机后缀>.code.run`。后缀是随机生成的，**重建服务可能变**，不要把它硬编码到别处。
   `code.run` 域名自带 TLS。
2. **前端能否打到后端**。浏览器打开 `https://<web 域名>/api/v1/health`，应返回 JSON。
   502 表示 Nginx 连不上后端：检查 `xunji-web` 的运行时变量 `API_UPSTREAM` 是否为 `http://xunji-api:8000`（内部服务名 + 容器端口）。
3. **数据库扩展**。在 addon 的控制台里执行：

   ```sql
   SELECT extname FROM pg_extension;
   SELECT * FROM pg_available_extensions WHERE name IN ('vector','pg_trgm','pgcrypto');
   ```

   迁移用 `CREATE EXTENSION IF NOT EXISTS vector / pg_trgm / pgcrypto`（`backend/migrations/0001_init.sql`）。
   Northflank 文档明确列出 `vector`；`pg_trgm` 与 `pgcrypto` 是 PostgreSQL contrib 模块，属于 `trusted` 扩展，**但 Northflank 文档只列了部分可用扩展**，请以第二条查询的实际结果为准。
   只要这两个之一不可用，迁移就会失败、API 启动即退出 —— 此时只能换一个提供这两个扩展的 PostgreSQL（自建或别的托管服务），把它的连接串通过 secret group 注入即可，模板其余部分不用改。
4. **Worker 日志**。应看到 `worker_started`，以及首次启动时的 `worker_migrations_applied`（如果 API 先跑完迁移，这里就不出现）。
   API 与 Worker 各自在启动时执行迁移，靠 `backend/app/db.py` 里的事务级 advisory lock 串行化，并发启动不会重复建表。

## 换成真实的 AI / 向量服务

模板里给的是默认离线配置：`AI_PROVIDER=extractive`、`EMBEDDING_PROVIDER=local`、`EMBEDDING_DIM=1536`。它能完整跑通（摘要、分块、索引、检索），但摘要质量明显低于模型。

要接真实服务：Project → Secrets → `xunji-env` → 添加变量，然后重启 API 与 Worker。

| 变量 | 示例 | 说明 |
|---|---|---|
| `AI_PROVIDER` | `openai` | `openai` 与 `openai-compatible` 等价，指任何 OpenAI 兼容服务 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | `https://api.openai.com/v1` / `sk-…` / `gpt-4o-mini` | |
| `EMBEDDING_PROVIDER` | `openai` | |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | | |
| `EMBEDDING_DIM` | `1536` | **必须等于模型真实输出维度**，否则启动失败（这是刻意设计） |

注意两点：

- 密钥只放在 secret group 里，不要写进 `northflank.json` —— 模板会进 Git。
- **换 `EMBEDDING_DIM` 需要重建向量列和索引**。已经入库的向量是旧维度，改变维度后 `document_chunks.embedding` 与索引都要重做；生产环境请在空库时就把维度定好。

## 手机 App 指向生产

App 打包时内联 API 地址，必须重打：

```bash
EXPO_PUBLIC_API_BASE_URL=https://<web 域名>/api/v1 npm run dev:mobile -- -c
# 生产构建（EAS / 原生）同理，环境变量在建构建前设置
```

指向 **web 域名**而不是 API 服务：Nginx 已经代理 `/api/`，对外只有一个 HTTPS 域名，App 也就不用再关心 API 的内部地址。
生产构建要求 HTTPS，`APP_VARIANT=production` 时不会放行明文 HTTP。

不需要本机装 Android Studio 的话，用仓库里的 `.github/workflows/android.yml`：

1. Settings → Secrets and variables → Actions → **Variables** → 新建 `XUNJI_API_BASE_URL`，值为 `https://<web 域名>/api/v1`（工作流会拒绝非 HTTPS 的值）。
2. 推送 `main`，或在 Actions → **Android APK** → Run workflow。
3. 跑完后在该次运行页底部下载 artifact `xunji-apk-<sha>`，里面是 `xunji-<sha>-arm64.apk`，传到手机安装（需允许“未知来源”）。

它只能构建 Android：iOS 需要 macOS runner，用 EAS 或本机 Xcode。签名用的是 RN/Expo 模板的 debug 密钥，适合自己安装，不能上架。

## 说明页（landing，可选）

模板里没有说明页 —— 它是独立的静态站，部署与否不影响应用。要部署：

1. 新建 Combined service，仓库同上，构建类型 Dockerfile，构建上下文 `/`，Dockerfile `/apps/landing/Dockerfile`，公开端口 80。
2. **构建参数** `XUNJI_RUNTIME_URLS=1`：保留 `__APP_URL__` / `__SITE_URL__` 占位符，因为公开域名要等部署后才生成。
3. **运行时变量** `XUNJI_APP_URL=https://<web 域名>`。`XUNJI_SITE_URL` 不用填，容器启动脚本会取 `NF_HOSTS` 的第一项作为自身地址
   （`apps/landing/docker-entrypoint.d/40-xunji-urls.sh`，在 Nginx 启动前用 `sed` 替换）。

## 已知限制

- 三个运行时服务都是 **1 个副本**。API 无状态，可以加副本（迁移的 advisory lock 已保证安全）；Worker 多副本也安全（`FOR UPDATE SKIP LOCKED`），但收益不大。
- 模板里没有健康检查：模板 schema 里 `healthChecks.path/port` 只接受模板表达式，不能写字面量。建议在 UI 给 `xunji-api` 补一个 HTTP 健康检查 `/api/v1/health`、端口 8000；`xunji-web` 用 `/` 即可。
- **后端目前没有限流**。`/api/v1/auth/register` 一旦公网可达就能被刷；在补上 `/auth/*` 限流之前，建议先不公开注册，或加一层 Cloudflare / Nginx `limit_req`。
- 数据库 6 GB 起步，pgvector 的向量索引会随文档量增长，注意监控存储。
- addon 支持定时备份（`backupsDump`），模板没有配置，建议在 UI 里打开。
- 模板重跑会对同名资源做更新/重建，不是严格的幂等部署工具；改动结构后先在草稿里 dry-run。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 模板 dry-run 报无法解析 `${refs.*}` | 前面的节点没建出来（构建失败、数据库超时） | 先看失败节点日志，修好后重跑 |
| 构建日志报找不到 Dockerfile | 平台的 `dockerFilePath` 若按「相对工作目录」解释，`/backend/Dockerfile` 会变成 `/backend/backend/Dockerfile` | 把该服务的 Dockerfile 路径改成 `/Dockerfile`（工作目录仍是 `/backend`），或把工作目录设为 `/`、路径保持 `/backend/Dockerfile`；Web 服务同理 |
| API 启动即退出，日志提到 `EMBEDDING_DIM` | 维度与 provider 实际输出不符 | 改 secret group 后重启 |
| API 启动报 `relation "documents" does not exist` | 迁移没跑成 | 多半是扩展创建失败，按上面第 3 条检查 `pg_available_extensions` |
| `https://<web 域名>/api/v1/health` 返回 502 | `API_UPSTREAM` 写错，或 `xunji-api` 未就绪 | 确认内部服务名 `xunji-api` 与端口 8000 |
| Worker 反复重启 | 数据库还没 running，或 secret group 没拿到 `DATABASE_URL` | 确认 addon 已 running、`xunji-env` 的 addon 依赖里有 `POSTGRES_URI → DATABASE_URL` |
| 登录后列表为空、换账号也空 | 数据确实为空（每个账号独立） / 连到了另一个数据库 | 在 addon 控制台 `SELECT count(*) FROM documents;` 核对 |
| App 里所有请求失败 | `EXPO_PUBLIC_API_BASE_URL` 指向了内网地址或旧域名 | 重新打包，值改成 `https://<web 域名>/api/v1` |
