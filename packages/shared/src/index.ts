// 与 docs/ENGINEERING.md 第 5 节 API 契约一一对应。

export type SourceType = 'web' | 'wechat' | 'github' | 'youtube' | 'bilibili' | 'twitter'

export type ParseStatus =
  | 'pending'
  | 'fetching'
  | 'parsing'
  | 'analyzing'
  | 'indexing'
  | 'completed'
  | 'partial'
  | 'failed'

export type ParseStage = 'fetch' | 'parse' | 'summarize' | 'chunk' | 'embed' | 'index'

export type SortOption = 'saved_at_desc' | 'saved_at_asc'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export interface User {
  id: string
  email: string
  created_at: string
}

export interface AuthResponse {
  token: string
  user: User
}

/** DocumentSummary：列表与搜索外的通用摘要字段 */
export interface DocumentSummary {
  id: string
  url: string
  title: string | null
  source_type: SourceType
  site_name: string | null
  summary_short: string | null
  parse_status: ParseStatus
  parse_error_code: string | null
  saved_at: string
}

/** Detail：Summary 全字段 + 正文与元数据 */
export interface DocumentDetail extends DocumentSummary {
  canonical_url: string
  author: string | null
  published_at: string | null
  description: string | null
  summary_long: string | null
  keywords: string[]
  topics: string[]
  language: string | null
  content_markdown: string | null
  plain_text: string | null
  /** 正文里的图片地址（本机解析时抓取；后端解析的条目可能没有这个字段）。 */
  images?: string[]
  /** 与 images 等长的本地文件路径；空字符串表示这张没落盘。 */
  image_files?: string[]
  metadata: Record<string, unknown>
  last_parsed_at: string | null
  parse_stage: ParseStage | null
}

export interface CreateDocumentResponse {
  id: string
  url: string
  title: string | null
  source_type: SourceType
  parse_status: ParseStatus
  created_at: string
  duplicate: boolean
}

export interface DocumentListParams {
  page?: number
  page_size?: number
  source_type?: SourceType | ''
  parse_status?: ParseStatus | ''
  keyword?: string
  sort?: SortOption
}

export interface DocumentListResponse {
  items: DocumentSummary[]
  total: number
  page: number
  page_size: number
}

export interface ReprocessResponse {
  job_id: string
  status: string
  created: boolean
}

export interface DocumentStatusResponse {
  document_id: string
  status: ParseStatus
  stage: ParseStage | null
  progress: number | null
  error_code: string | null
}

export interface RelatedItem {
  document_id: string
  title: string | null
  url: string
  score: number
  relation_type: string
}

export interface RelatedResponse {
  items: RelatedItem[]
}

export interface SearchResult {
  document_id: string
  title: string | null
  url: string
  source_type: SourceType
  site_name: string | null
  summary: string | null
  score: number
  match_reason: string
  matched_excerpt: string | null
  /** 命中方式：字面匹配，或只找到意思相近的内容。 */
  match_kind?: 'literal' | 'semantic'
  /** 失败原因，用于列表里说清「为什么没读到」。 */
  parse_error_code?: string | null
  saved_at: string
  parse_status: ParseStatus
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}

// 平台无关的运行时常量与工具：Web 与移动端共用，禁止引入 DOM / 原生 API。
export * from './format'
export * from './errors'
