# Trovia 工程契约（ENGINEERING）

本文是 Trovia 的工程实现契约。所有实现必须遵守这里的文件路径、函数签名、数据结构和 API 契约。
产品定位与边界见 `docs/PRODUCT.md`；涉及实现细节时以本文为准。

---

## 1. 仓库结构

```text
trovia/
├── docs/PRODUCT.md
├── docs/ENGINEERING.md
├── README.md
├── CLAUDE.md
├── .env.example
├── docker-compose.yml
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── pytest.ini
│   ├── migrations/
│   │   └── 0001_init.sql
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py            # FastAPI app 工厂 + 路由挂载 + 异常处理
│   │   ├── config.py          # pydantic-settings
│   │   ├── db.py              # engine / SessionLocal / get_db / session_scope / run_migrations
│   │   ├── models.py          # SQLAlchemy ORM（与 0001_init.sql 一一对应）
│   │   ├── schemas.py         # Pydantic 请求/响应模型
│   │   ├── errors.py          # ApiError + 统一 {"error":{code,message}} 处理器
│   │   ├── logging.py         # 结构化日志（JSON line）
│   │   ├── auth.py            # 密码哈希、token 签发/校验、get_current_user 依赖
│   │   ├── fetch.py           # SSRF 安全的 httpx 抓取（自管重定向）
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── health.py
│   │   │   ├── auth_api.py
│   │   │   ├── documents_api.py
│   │   │   └── search_api.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── url_utils.py   # URL 规范化 + 去重哈希 + 来源识别
│   │   │   ├── document_service.py
│   │   │   └── search_service.py
│   │   ├── parsers/
│   │   │   ├── __init__.py
│   │   │   ├── base.py        # ParseResult + Parser 协议
│   │   │   ├── registry.py    # get_parser(url, source_type)
│   │   │   ├── generic.py
│   │   │   ├── wechat.py
│   │   │   ├── github.py
│   │   │   └── video.py       # youtube / bilibili / twitter 元数据
│   │   ├── ai/
│   │   │   ├── __init__.py
│   │   │   ├── chunking.py
│   │   │   ├── openai_compat.py # 兼容层：URL/鉴权头/额外头/别名
│   │   │   ├── summary.py     # SummaryProvider + OpenAI 兼容 + 本地抽取式
│   │   │   ├── embedding.py   # EmbeddingProvider + OpenAI 兼容 + 本地哈希
│   │   │   └── pipeline.py    # process_document() 全流程编排
│   │   └── workers/
│   │       ├── __init__.py
│   │       ├── queue.py       # enqueue/claim/complete/fail/reclaim
│   │       └── runner.py      # python -m app.workers.runner
│   └── tests/
│       ├── conftest.py
│       ├── fixtures/          # 解析器用的离线 HTML 样例
│       ├── test_url_utils.py
│       ├── test_ssrf.py
│       ├── test_auth.py
│       ├── test_documents_api.py
│       ├── test_parsers.py
│       ├── test_chunking.py
│       ├── test_summary_embedding.py
│       ├── test_queue.py
│       ├── test_pipeline.py
│       └── test_search.py
├── package.json             # npm workspaces 根（apps/*、packages/*）
├── package-lock.json
├── apps/
│   ├── web/                 # @trovia/web：React + Vite 应用（用户实际使用的界面）
│       ├── package.json
│       ├── vite.config.ts   # dev 代理 /api → XUNJI_API_TARGET || localhost:8000
│       ├── tsconfig.json
│       ├── index.html
│       ├── Dockerfile       # 构建上下文必须是仓库根目录
│       ├── nginx.conf
│       └── src/
│           ├── main.tsx
│           ├── App.tsx          # 路由 + 侧栏导航
│           ├── styles.css
│           ├── api/client.ts    # @trovia/api 适配：base URL / localStorage token / 401 跳转
│           ├── components/      # SearchBox, SaveBox, DocumentCard, StatusBadge,
│           │                    # LiveStatusBadge, Toast, Markdown, AuthForm
│           └── pages/           # Home, Documents, DocumentDetail, Settings,
│                                # Login, Register
│   ├── mobile/              # @trovia/mobile：独立 iOS + Android 客户端（Expo / RN）
│   │   ├── app/             # Expo Router：index/login/register/documents/[id]/settings/share
│   │   ├── src/
│   │   │   ├── api/client.ts    # @trovia/api 适配：绝对 base URL / SecureStore token / 401 事件
│   │   │   ├── auth/            # AuthProvider、SecureStore token、待处理分享
│   │   │   ├── storage/         # AsyncStorage 键、缓存用户、离线待保存队列
│   │   │   ├── outbox/          # 单飞、顺序刷新队列
│   │   │   ├── share/           # expo-share-intent 桥（Expo Go 下跳过）
│   │   │   ├── components/      # 与 Web 相同信息层级的 RN 组件
│   │   │   ├── screens/         # Home / Documents / Detail / Settings / Auth / Share
│   │   │   ├── hooks/           # useLiveStatus、useDebouncedValue
│   │   │   └── theme.ts         # 纸感设计令牌（仅浅色）
│   │   ├── app.config.ts    # scheme / bundle id / 分享插件 / 开发期 ATS 与 cleartext
│   │   ├── metro.config.js  # monorepo watchFolders + nodeModulesPaths
│   │   └── tsconfig.json
│   └── landing/              # @trovia/landing：纯静态说明页（无框架），
│                             # dev 5174，构建时注入 XUNJI_APP_URL / XUNJI_SITE_URL
│       ├── package.json
│       ├── vite.config.ts    # transformIndexHtml 替换 __APP_URL__ / __SITE_URL__
│       ├── public/shots/     # 真实产品截图（搜索页 / 首页 / og 分享图）
│       ├── index.html
│       ├── styles.css
│       └── Dockerfile        # 构建上下文必须是仓库根目录
└── packages/
    ├── api/                # @trovia/api：createApiClient（请求/超时/信封/401 回调/接口定义）
    │   ├── package.json
    │   └── src/index.ts
    └── shared/              # @trovia/shared：第 5 节 API 契约类型 + 平台无关的
        ├── package.json     # format.ts / errors.ts（web 与 mobile 共用）
        └── src/index.ts
```

## 2. 技术基线与约定

- 后端 Python 3.12+，**同步** SQLAlchemy 2.0（`psycopg` v3 驱动），**不使用 async**。
- 依赖：`fastapi`、`uvicorn[standard]`、`sqlalchemy>=2.0`、`psycopg[binary]>=3.1`、
  `pydantic>=2`、`pydantic-settings`、`httpx`、`beautifulsoup4`、`lxml`、`trafilatura`；
  测试：`pytest`、`pytest-cov`。
- 迁移：`backend/migrations/*.sql` 由 `app/db.py::run_migrations()` 顺序执行，记录在
  `schema_migrations(version text primary key, applied_at timestamptz)`；文件内 `{{EMBEDDING_DIM}}`
  会被替换为 `settings.embedding_dim`。迁移必须幂等（`IF NOT EXISTS`）。
- 所有用户数据查询强制带 `user_id`；越权一律返回 404 `NOT_FOUND`（不暴露存在性）。
- 错误响应统一：`{"error": {"code": "...", "message": "..."}}`。业务错误抛
  `errors.ApiError(code, message, status_code)`。
- 日志：`logging.py` 提供 `get_logger(name)`，输出 JSON 行，字段
  `ts, level, logger, msg, request_id?, document_id?, job_id?, stage?, duration_ms?, status?, error_code?`。
  禁止打印 API 密钥与完整正文。
- 前端 TypeScript + React 19 + Vite + react-router-dom；不引入组件库或 CSS 框架。
  样式由 `src/styles.css` 单文件承载（「温润纸感」：米白纸面、墨色文字、赭红点缀），
  设计令牌为 `--paper/--surface/--ink/--ink-soft/--muted/--faint/--line/--line-strong/`
  `--accent/--accent-deep/--accent-soft/--success/--warning/--error`。
  列表用发丝分隔行，控件使用原生 `button/input`，状态只在未整理完成时出现。
  Markdown 由自写受限渲染器转为 React 元素（`.markdown-body`）；Toast 与删除确认均为自写实现。
  禁止 `dangerouslySetInnerHTML`；Markdown 渲染不启用 raw HTML。
- 移动端 TypeScript + Expo SDK 58 + React Native 0.88 + Expo Router；不引入 UI 库、CSS 框架、
  React Query、Markdown 组件库、WebView 或字体包。样式使用 RN `StyleSheet`，视觉令牌与 Web 一致，
  仅浅色。`ios/`、`android/` 由 Expo prebuild 生成，不提交。
- 平台无关的展示/校验逻辑（状态文案与色调、终端状态、域名/日期、URL 提取、错误文案、`ApiError`）
  必须放在 `packages/shared`，Web 与 mobile 从 `@trovia/shared` 导入；shared 不得引用 DOM、
  `window`、`localStorage` 或 React Native API。
- 平台无关的 HTTP 传输（路径与 query、15s 超时、`{data}` 解包、错误信封、401 回调、接口定义）
  放在 `packages/api` 的 `createApiClient`，Web 与 mobile 从 `@trovia/api` 导入。两端
  `api/client.ts` 只做适配：base URL、token 读取、401 后的清 token/跳转或事件；不得复制请求逻辑。
  `packages/api` 不引用 `window`、`localStorage` 或 React Native API，token 与 401 副作用由 adapter 注入。
  401 回调会带上本次请求实际使用的 token，适配层据此忽略旧会话的迟到响应。
- 移动端 token 只放 `expo-secure-store`；AsyncStorage 只存非敏感状态（缓存用户、待保存 URL 队列、
  未登录时的待处理分享）。不得记录 token。原生请求不受同源限制，后端不需要 CORS。

## 3. 配置（环境变量，`app/config.py`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://trovia:trovia@localhost:5432/trovia` | SQLAlchemy URL |
| `APP_SECRET` | 空（生产必填） | 派生 token 用 |
| `AI_PROVIDER` | `extractive` | `extractive` \| `openai` \| `openai-compatible`（后两者等价） |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | 空 / `https://api.openai.com/v1` / `gpt-4o-mini` | 摘要与关键词；API Key 可为空（本地服务） |
| `AI_CHAT_PATH` | `/chat/completions` | 接口路径，可带查询参数 |
| `AI_AUTH_HEADER` / `AI_AUTH_PREFIX` | `Authorization` / `Bearer` | 鉴权头名与前缀；前缀为空则直接发送 key |
| `AI_EXTRA_HEADERS` | `{}` | JSON 对象，附加请求头 |
| `AI_JSON_MODE` | `true` | 是否发送 `response_format={"type":"json_object"}` |
| `AI_TIMEOUT_SECONDS` | `60` | |
| `EMBEDDING_PROVIDER` | `local` | `local` \| `openai` \| `openai-compatible`（后两者等价） |
| `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` | 同上风格 | embedding |
| `EMBEDDING_PATH` / `EMBEDDING_AUTH_HEADER` / `EMBEDDING_AUTH_PREFIX` / `EMBEDDING_EXTRA_HEADERS` | 同上风格 | embedding 兼容层 |
| `EMBEDDING_TIMEOUT_SECONDS` | `60` | |
| `EMBEDDING_DIM` | `1536` | 必须与模型输出维度一致，否则启动即报错 |
| `LOG_LEVEL` | `INFO` | |
| `FETCH_TIMEOUT_SECONDS` | `15` | 连接+读取总超时 |
| `FETCH_MAX_BYTES` | `5242880` (5MB) | 响应体上限 |
| `FETCH_MAX_REDIRECTS` | `5` | 每跳重新做 SSRF 校验 |
| `FETCH_ALLOWED_PORTS` | `80,443,8080,8443` | |
| `CHUNK_MAX_CHARS` | `1200` | |
| `CHUNK_OVERLAP` | `150` | |
| `SEARCH_LEXICAL_WEIGHT` | `0.35` | 融合权重，见 6.3 |
| `SEARCH_SEMANTIC_WEIGHT` | `0.35` | |
| `SEARCH_TITLE_WEIGHT` | `0.20` | |
| `SEARCH_META_WEIGHT` | `0.10` | |
| `SEARCH_MIN_SCORE` | `0.05` | 低于此分不返回 |
| `WORKER_POLL_SECONDS` | `1.0` | |
| `WORKER_LEASE_SECONDS` | `300` | 超时任务可被回收 |
| `JOB_MAX_ATTEMPTS` | `3` | |

启动时校验：provider 别名合法、base URL/模型已配置、额外请求头是合法 JSON、
`embedding` 维度 != `EMBEDDING_DIM` → 抛错退出（不允许维度不一致的向量入库）。
API Key 允许为空，以支持 Ollama、vLLM 等无鉴权本地服务。

## 4. 数据库 DDL（`migrations/0001_init.sql` 必须完全一致）

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (lower(email));

CREATE TABLE IF NOT EXISTS auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_auth_tokens_user ON auth_tokens(user_id);

CREATE TABLE IF NOT EXISTS documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_url        text NOT NULL,
  canonical_url       text NOT NULL,
  normalized_url_hash text NOT NULL,
  source_type         text NOT NULL DEFAULT 'web',
  site_name           text,
  title               text,
  author              text,
  published_at        timestamptz,
  description         text,
  summary_short       text,
  summary_long        text,
  keywords            text[] NOT NULL DEFAULT '{}',
  topics              text[] NOT NULL DEFAULT '{}',
  plain_text          text,
  content_markdown    text,
  language            text,
  parse_status        text NOT NULL DEFAULT 'pending',
  parse_stage         text,
  parse_error_code    text,
  parse_error_message text,
  content_hash        text,
  metadata_json       jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at            timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_parsed_at      timestamptz
);
-- 删除采用硬删除（级联清理 chunks/jobs/relations），因此不做软删除唯一索引：
-- 删除后重新保存同一 URL 会产生全新记录，这是预期行为。
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_user_urlhash
  ON documents(user_id, normalized_url_hash);
CREATE INDEX IF NOT EXISTS ix_documents_user_saved ON documents(user_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS ix_documents_user_status ON documents(user_id, parse_status);
CREATE INDEX IF NOT EXISTS ix_documents_user_source ON documents(user_id, source_type);
CREATE INDEX IF NOT EXISTS ix_documents_title_trgm ON documents USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_documents_plain_trgm ON documents USING gin (coalesce(plain_text,'') gin_trgm_ops);

CREATE TABLE IF NOT EXISTS document_chunks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chunk_index      int NOT NULL,
  content          text NOT NULL,
  content_hash     text NOT NULL,
  token_count      int NOT NULL DEFAULT 0,
  embedding        vector({{EMBEDDING_DIM}}),
  embedding_model  text,
  embedding_version int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_chunks_document ON document_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS ix_chunks_user ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS processing_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type          text NOT NULL DEFAULT 'process_document',
  status            text NOT NULL DEFAULT 'queued',   -- queued|running|retrying|completed|failed|cancelled
  attempt_count     int NOT NULL DEFAULT 0,
  max_attempts      int NOT NULL DEFAULT 3,
  available_at      timestamptz NOT NULL DEFAULT now(),
  locked_at         timestamptz,
  locked_by         text,
  last_error_code   text,
  last_error_message text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ix_jobs_claim ON processing_jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS ix_jobs_document ON processing_jobs(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_active_document
  ON processing_jobs(document_id, job_type)
  WHERE status IN ('queued','running','retrying');

CREATE TABLE IF NOT EXISTS document_relations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relation_type      text NOT NULL,          -- semantic_similarity|shared_topic|same_source
  score              real NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, target_document_id, relation_type)
);
CREATE INDEX IF NOT EXISTS ix_relations_source ON document_relations(source_document_id, score DESC);
```

`source_type` ∈ `web | wechat | github | youtube | bilibili | twitter`。
`parse_status` ∈ `pending | fetching | parsing | analyzing | indexing | completed | partial | failed`。
`parse_stage` ∈ `fetch | parse | summarize | chunk | embed | index`（供 `/status` 的 `stage` 字段）。
错误码：`INVALID_URL | FETCH_TIMEOUT | FETCH_BLOCKED | FETCH_ERROR | CONTENT_NOT_FOUND |
UNSUPPORTED_CONTENT | AI_PROVIDER_ERROR | EMBEDDING_ERROR | INDEX_WRITE_ERROR | PARSE_ERROR`。
`metadata_json` 保留给来源特有字段（如 wechat 的 `account`、github 的 `stars/language`、
`images`、`links`、`parser`）。

## 5. API 契约（前缀 `/api/v1`，全部 JSON，Bearer 认证，公开接口仅 register/login/health）

统一错误：`{"error":{"code":"INVALID_URL","message":"请输入有效的 HTTP 或 HTTPS 链接。"}}`

**成功响应统一包一层 `{"data": ...}`**：注册/登录返回
`{"data":{"token","user"}}`，列表返回 `{"data":{"items","total","page","page_size"}}`，搜索返回
`{"data":{"query","results","total"}}`。仅 `/health` 例外返回裸 `{"status":"ok"}`，`DELETE` 返回 204 无 body。

| 方法 | 路径 | 请求 | 响应 `data` |
|---|---|---|---|
| GET | `/health` | - | `{"status":"ok"}` |
| POST | `/auth/register` | `{"email","password"}`(password≥8) | `{"token","user":{"id","email","created_at"}}` 201 |
| POST | `/auth/login` | `{"email","password"}` | 同上 200；401 `INVALID_CREDENTIALS` |
| POST | `/auth/logout` | - | 204 |
| GET | `/auth/me` | - | `{"id","email","created_at"}` |
| POST | `/documents` | `{"url"}` | 见下 201；重复 200 且 `duplicate:true` |
| GET | `/documents?page=1&page_size=20&source_type=&parse_status=&keyword=&sort=` | - | `{"items":[Summary],"total","page","page_size"}` |
| GET | `/documents/{id}` | - | `Detail` |
| DELETE | `/documents/{id}` | - | 204 |
| POST | `/documents/{id}/reprocess` | - | `{"job_id","status","created":bool}` |
| GET | `/documents/{id}/status` | - | `{"document_id","status","stage","progress":null\|int,"error_code"}` |
| GET | `/documents/{id}/related` | - | `{"items":[{"document_id","title","url","score","relation_type"}]}` |
| POST | `/search` | `{"query","limit":10}` | `{"query","results":[SearchResult],"total"}` |

`sort` ∈ `saved_at_desc`（默认）`| saved_at_asc`；`page_size` ≤ 100。

- **DocumentSummary**：`{id, url, title, source_type, site_name, summary_short, parse_status, parse_error_code, saved_at}`
- **Detail**：Summary 全字段 + `{canonical_url, author, published_at, description, summary_long,
  keywords[], topics[], language, content_markdown, metadata, last_parsed_at, parse_stage}`
  （`plain_text` 只用于检索，不下发给前端）
- **CreateDocument 响应**：`{id, url, title, source_type, parse_status, created_at, duplicate}`
- **SearchResult**：`{document_id, title, url, source_type, site_name, summary, score, match_reason,
  matched_excerpt, saved_at, parse_status}`
  - `score`：0–1 融合分，非百分比。
  - `match_reason`：模板化、基于真实证据（命中通道 + 真实命中的词 + 来源），中文，不虚构。
  - `matched_excerpt`：真实命中的正文/摘要片段（≤200 字符），无则退化为摘要首句。

列表/搜索的 `data` 外层不要包 `error`；空结果 `results: []`、`total: 0`，不报错。

## 6. 关键模块签名（跨切片必须一致）

### 6.1 `services/url_utils.py`
```python
@dataclass(frozen=True)
class NormalizedUrl:
    original: str; canonical: str; url_hash: str  # sha256(canonical)
    host: str; scheme: str; source_type: str

def normalize_url(raw: str) -> NormalizedUrl        # 空/非 http(s)/非法 → raise ApiError("INVALID_URL",…,400)
def extract_first_url(raw: str) -> str | None       # 从分享文字中取第一段 http(s) 链接
def detect_source_type(host: str) -> str            # wechat/github/youtube/bilibili/twitter/web
def dedupe(session, user_id: str, url_hash: str) -> Document | None
```
规范化规则（保守）：小写 scheme+host、去 fragment、去默认端口、去尾部 `/`（根路径除外）、
按 key 排序 query、删除追踪参数 `utm_* gclid fbclid from sca weibo_id spm`，其余保留。
`normalize_url` 接受纯链接或手机分享文字：文字中提取第一条 http(s) 链接后再规范化。

### 6.2 `fetch.py`
```python
@dataclass
class FetchResult:
    url: str; final_url: str; status_code: int; headers: dict; text: str; truncated: bool

def safe_fetch(url: str, *, timeout: float, max_bytes: int, max_redirects: int,
               allowed_ports: set[int]) -> FetchResult
    # 手动逐跳重定向，每一跳先 validate_ssrf；非 2xx 抛 FetchError(code)
def validate_ssrf(url: str, allowed_ports: set[int]) -> None
    # scheme、host、DNS 解析后逐 IP 校验：拒绝 loopback/private/link-local/ULA/
    # 云元数据(169.254.169.254,fd00:ec2::254)/IPv4-mapped IPv6/未知解析失败
def unsafe_url_error(url: str) -> ApiError        # FETCH_BLOCKED, 400
```

### 6.3 `parsers/`
```python
@dataclass
class ParseResult:
    source_type: str; original_url: str; canonical_url: str
    title: str | None; author: str | None; published_at: datetime | None
    site_name: str | None; description: str | None
    content_markdown: str | None; plain_text: str | None
    images: list[str]; links: list[str]; language: str | None
    parse_status: str                 # completed | partial | failed
    error_code: str | None; error_message: str | None
    metadata: dict                    # 来源特有字段

class Parser:
    name: str
    def matches(self, url: str, source_type: str) -> bool: ...
    def parse(self, fetched: FetchResult) -> ParseResult: ...

def get_parser(url: str, source_type: str) -> Parser   # registry：wechat/github/video/generic 优先级
```
解析失败**不得**虚构正文；只拿到标题/描述时 `parse_status='partial'`。

### 6.4 `ai/`
```python
# chunking.py
def chunk_text(text: str, max_chars: int = 1200, overlap: int = 150) -> list[str]
    # 段落优先，按空行/换行切；超长段落按句子再切；保留顺序；不做固定字符硬截断拆句
    # 返回非空 list，空文本返回 []

# summary.py
@dataclass
class SummaryResult:
    summary_short: str; summary_long: str; keywords: list[str]; topics: list[str]
class SummaryProvider:
    def summarize(self, title: str, text: str) -> SummaryResult   # 失败抛 SummaryProviderError(AI_PROVIDER_ERROR)
def get_summary_provider(settings) -> SummaryProvider     # openai / openai-compatible | extractive

# embedding.py
class EmbeddingProvider:
    dim: int
    def embed(self, texts: list[str]) -> list[list[float]]  # 失败抛 EmbeddingProviderError(EMBEDDING_ERROR)
def get_embedding_provider(settings) -> EmbeddingProvider   # openai / openai-compatible | local
# 校验：provider.dim != settings.embedding_dim → 启动抛 RuntimeError

# openai_compat.py
# build_url(base_url, path) / build_headers(api_key, auth_header, auth_prefix, extra_headers)
# is_openai_compatible(provider) / parse_extra_headers(json) / require_openai_settings(...)

# pipeline.py
def process_document(session, document_id: str, job_id: str, settings) -> None
    # 抓取→解析→写 documents→摘要/关键词→chunk→embed→写 chunks→关联→状态
    # 阶段更新 parse_status/parse_stage；可恢复错误抛 RetryableJobError(code,msg)，
    # 不可恢复抛 FatalJobError；任何情况下不得删除 documents 记录。
```
`extractive` 与 `local` 是真实算法（抽取式摘要 / 特征哈希向量），离线可用，用于默认配置与测试。

### 6.5 `workers/queue.py`
```python
def enqueue(session, document: Document, job_type="process_document", *, max_attempts: int) -> Job
    # 已有 active job（queued/running/retrying）→ 返回该 job（幂等，不新建）
def claim_job(session, worker_id: str, *, lease_seconds: int) -> Job | None
    # SELECT … FOR UPDATE SKIP LOCKED；status→running, locked_at, locked_by, attempt_count+1
def complete_job(session, job) -> None
def fail_job(session, job, *, error_code: str, message: str, retryable: bool) -> None
    # attempt_count < max_attempts 且 retryable → status='retrying', available_at=now()+backoff(2^n 秒, 上限 300)
    # 否则 status='failed', completed_at=now()；document.parse_status='failed'
def reclaim_stale(session, *, lease_seconds: int) -> int   # running 且 locked_at 超时 → 重新 queued
def cancel_active_jobs(session, document_id: str) -> int
```
`workers/runner.py`：`python -m app.workers.runner`，循环 claim→执行→complete/fail，
捕获 SIGTERM/SIGINT 优雅退出；`reclaim_stale` 每轮执行；日志带 `job_id/document_id/stage/duration_ms`。

### 6.6 `services/search_service.py`
```python
@dataclass
class SearchHit:
    document_id: str; title: str | None; url: str; source_type: str; site_name: str | None
    summary: str | None; score: float; match_reason: str; matched_excerpt: str | None
    saved_at: datetime; parse_status: str

def search(session, user_id: str, query: str, limit: int = 10, settings=None) -> list[SearchHit]
```
实现要求：
1. 四路召回（同一 SQL 内完成或分步合并）：
   - 查询预处理：去掉「之前看过一篇文章」「讲的是」「帮我找」「好像还提到了」等叙事/提问外壳，
     按标点、空白及中英文边界切出内容词；term 之间用 `OR` 交给全文查询，避免长句被当成必须全部命中的短语。
   - 全文：`to_tsvector('simple', title||summary||plain_text) @@ websearch_to_tsquery('simple', terms)`，`ts_rank_cd` 归一化。
   - 三元组：`similarity(title, clean_q)`、`similarity(summary, clean_q)` 与 `similarity(plain_text, clean_q)`（pg_trgm，覆盖中文子串场景）。
   - 词面：把清理后的 term（外加整串 query / clean_q）对 `title/summary/keywords/plain_text/topics/site_name/author/描述/URL` 做 ILIKE。
   - 语义：清理后的查询向量化，`document_chunks.embedding <=> :qvec` 取 top 50 chunk，按文档聚合 `max(1 - distance)`。
   - 摘要与正文同属 lexical 证据：只记得摘要里的说法、正文没有原词时也能召回。
2. 每路分数在候选集内 min-max 归一化到 [0,1]，按配置权重加权求和 → `score`，
   低于 `SEARCH_MIN_SCORE` 剔除，按 `score DESC` 排序。
3. `match_reason` 由真实证据拼模板，例：
   - `"正文与「任务调度」相关：命中关键词「调度」，与你描述的“轻量级任务调度工具”语义相近。"`
   - 只有摘要命中时：`"摘要命中关键词「任务调度」（来源 example.com）。"`
   - 只有语义命中时：`"正文语义上接近你描述的内容（来源 github.com）。"`
   - 必须包含真实命中的词或说明语义通道，禁止编造文章没有的内容；展示用 query 使用清理后的内容词。
4. 所有结果强制 `user_id = :user_id`（删除是硬删除，已删文档天然不在表中）；`parse_status='failed'` 的文档
   （无正文）只要 URL/标题可匹配也允许返回。
5. 不在搜索时调用任何模型（索引已预构建）。

## 7. 前端契约

### 7.1 Web

- API base：`/api/v1`（vite dev server proxy → `http://localhost:8000`；nginx 同样代理）。
- 请求通过 `@trovia/api` 的 `createApiClient`；本端 adapter 只提供相对 base URL、`localStorage`
  token 读取和 401 清 token + 跳 `/login`。请求默认 15s 超时。
- token 存 `localStorage["trovia_token"]`；401 → 清 token 并跳 `/login`。
  Web 也会校验本次 401 使用的 token 是否仍是当前 token，避免旧响应误清新会话。
- 路由：`/login`、`/register`、`/`、`/documents`、`/documents/:id`、`/settings`；未知路径回首页。
- 顶栏只有品牌、`账户`，不提供侧边栏；`收藏` 列表从首页「查看全部」进入。
- `/`：搜索框 + 保存框 + 最近 6 条收藏。搜索无结果时提示换一种描述或先保存；最近收藏为空时提示粘贴第一个链接。
- 保存：粘贴纯链接或含链接的分享文字后，自动提取第一段 http(s) URL 并启用保存按钮；成功 toast `已保存，正在整理内容……`；重复 toast `这篇内容已经保存过了。` 并提供打开已有收藏入口。
- 搜索结果卡片：标题、域名、来源、收藏时间、摘要、`为什么找到它` + `match_reason`、`matched_excerpt`（如有）、`打开原文`、状态徽章。
- `/documents`：标题「全部收藏」，单一关键词输入框，300ms 防抖，输入即筛选；按 `saved_at` 倒序；每页 20 条，底部「加载更多」。不做来源/状态筛选，也不做分页器。
- `/documents/:id`：详情、正文预览（Markdown 渲染、禁 raw HTML）、关键词、相关收藏、重新解析、删除（确认后 `DELETE`，回列表）。
- `/settings`：只显示邮箱、加入时间、隐私说明与退出登录。
- `LiveStatusBadge` 仅对非终态每 1.5s 轮询 `/documents/{id}/status`；`completed | partial | failed` 停止。
- 状态文案：pending→等待整理；fetching→读取网页中；parsing→整理正文中；analyzing→提取重点中；indexing→建立索引中；completed→已完成整理；partial→部分内容无法读取；failed→暂时无法解析。
- 异常兜底：服务端未给 message 时按错误码展示（如 `请输入有效的网页链接。`、`保存失败，请稍后重试。`、`搜索暂时不可用，请稍后重试。`）。

### 7.2 移动端（`apps/mobile`）——本地优先，无登录

- 独立 iOS + Android App，不是 PWA，**不调用 `/api/v1`**，不需要后端、账号或网络配置。
  收藏、正文、摘要与索引全部保存在本机；服务端仅保留给自托管与未来的多端同步。
- 本地库：`expo-sqlite` 打开 `trovia.db`（WAL；首次启动时把旧的 `xunji.db` 连同 -wal/-shm 一起搬过来）。`documents` 表字段与后端 DDL 对齐
  （`url`、`canonical_url`、`title`、`site_name`、`source_type`、`summary_*`、`keywords`、
  `content_markdown`、`plain_text`、`search_text`、`parse_status`、`parse_stage`、
  `parse_error_code`、`saved_at`、`last_parsed_at`、`updated_at`、`deleted_at`、`metadata`）。
- 同步准备：`updated_at` 每次写入都更新，删除写墓碑 `deleted_at` 而不物理删除；条目 `id`
  为设备内生成的稳定 UUID。`documents_url_active_idx` 是 `url WHERE deleted_at IS NULL`
  的部分唯一索引，删除后同一链接可以重新收藏。
- 解析流水线（`src/local/pipeline.ts`）：保存后 `pending → fetching → parsing →
  analyzing → completed`。抓取失败 `failed` + `FETCH_FAILED`；正文少于 120 字记
  `partial` + `PARSE_INCOMPLETE`，元信息照常保留。`processPendingQueue()` 单飞、串行，
  每次最多 20 条，在启动、保存、页面聚焦、回到前台和手动重试时触发。重新解析
  （`markForRetry`）把状态改回 `pending`。
- 检索完全在本地（`src/local/repo.ts`）：查询先去掉中文叙述性填充词，英文按词、中文按
  二元组切分；标题 10 / 关键词 7 / 摘要 4 / 正文 2 / 来源 3 加权，按查询词数归一化。
  `match_reason` 只写真实命中的字段与词，`matched_excerpt` 从原文截取。最多扫描最近
  2000 条。相关收藏用共享关键词 + 标题二元组重合度计算。
- 大模型（可选）：`src/local/llm.ts` 调用用户配置的任意 OpenAI 兼容
  `POST {baseUrl}/chat/completions`，30s 超时，要求返回
  `{"summary","keywords"}`（容忍代码块包裹）；服务地址与模型名存 AsyncStorage
  （`trovia.llm.v1`），API Key 只存 `expo-secure-store`（`trovia.llm.key.v1`），
  不写日志、不上传。未启用或调用失败时退回抽取式摘要，流水线不中断。
- 路由：`/`（首页）、`/documents`、`/documents/[id]`、`/settings`、`/share`，另有
  `/ask`（连续追问）、`/diagnostics`（排障记录）与设置子页 `/settings/llm`、`/settings/sync`、`/settings/import`。
  首页 / 收藏 / 我的三栏底部导航（`components/AppTabBar.tsx`，`router.replace` 切换，不保留历史）；
  其余页面均为无 Tab 的推入页。
- 首页：搜索 + 保存 + 最近 4 条；保存重复链接返回已有条目；保存后立即 `pending` 并触发流水线。
- `/documents`：关键词 300ms 防抖、20 条/页、触底加载。`/documents/[id]`：详情、Markdown、
  相关收藏、重新解析、删除确认、打开原文；非终态每 1.2s 读本地库状态（App 后台时暂停），
  终态停止并重载详情。
- 设置：本机收藏数量、大模型（开关 / 地址 / 模型 / Key / 保存 / 测试连接）、
  多端同步说明、清空全部收藏（二次确认，保留大模型设置）。
- 系统分享使用 `expo-share-intent`：iOS Share Extension + Android `ACTION_SEND`（`text/*`），
  仅 development build / 正式包可用，Expo Go 自动跳过分享桥。先读取合法 `webUrl`，否则从
  `text` 提取第一段 http(s) URL；**在异步保存前重置原生 payload**；随后直接进入 `/share`
  在本机保存并跳转详情，不需要登录。
- 原生限制：iOS 分享扩展会打开主 App 完成保存；没有 URL 的分享（仅标题/描述/短链）无法保存。
- 开发构建允许任意 HTTP（ATS 例外、Android cleartext），因为 App 直接抓取网页、也可能连接
  局域网模型服务；正式构建只允许 HTTPS。
- 视觉：独立的冷中性现代移动端设计语言（`src/theme.ts`）：浅冷灰画布、白色卡片、靛蓝强调色、
  系统无衬线；18px 卡片圆角 + 柔和投影、药丸形输入框、Ionicons 线性图标、底部 Tab、
  最小 44pt 触控高度；Markdown 为 RN 受限渲染，不注入 HTML、不用 WebView。

## 8. 验证命令（每个切片完成后必须自证）

```bash
# 后端虚拟环境（一次性）
cd backend && uv venv --python 3.12 && uv pip install -e '.[dev]'

# 迁移
cd backend && .venv/bin/python -m app.db --migrate

# 测试（独立测试库 trovia_test，自动建库与迁移）
cd backend && .venv/bin/python -m pytest -q
# 并行跑不同切片时用不同库：XUNJI_TEST_DB=trovia_test_search .venv/bin/python -m pytest -q

# API 冒烟
cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000
curl -s localhost:8000/api/v1/health

# Worker
cd backend && .venv/bin/python -m app.workers.runner

# 前端（monorepo，仓库根目录执行）
npm install
npm run api:typecheck    # @trovia/api
npm run typecheck -w @trovia/shared
npm run dev            # http://localhost:5173
npm run build          # 必须零 TS 错误

# 移动端（apps/mobile）
cd apps/mobile
npx tsc --noEmit
npx expo-doctor
npx expo config --type public
npx expo export --platform ios --output-dir dist/ios
npx expo export --platform android --output-dir dist/android
# 生成原生工程（不安装 pods / Gradle，目录不提交）
npx expo prebuild --no-install --platform ios
npx expo prebuild --no-install --platform android
```

移动端原生编译：Android 已在本机用 Android Studio JBR 25 + Gradle 9.6.0 构建 release APK，
并在 arm64 模拟器上连接局域网 API/Worker 完成登录、保存、找回、详情与系统分享冒烟。
iOS 目前只验证到 TypeScript、Expo 配置、JS bundle 与 prebuild；CocoaPods 拉取 SocketRocket
时网络失败，尚未编译运行。真机与 iOS 原生分享仍需要 Xcode / Android Studio / EAS Build。

安装依赖统一走镜像：`pip` 用 `http://mirrors.aliyun.com/pypi/simple`（`PIP_INDEX_URL`），
`npm` 用 `https://registry.npmmirror.com`。
