// One-to-one with the API contract in section 5 of docs/ENGINEERING.md.

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

/** DocumentSummary: the common summary fields, apart from lists and search */
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
  /** For list thumbnails: image URLs from the body, index-aligned with the local files. */
  images?: string[]
  image_files?: string[]
}

/** Detail: every Summary field plus body and metadata */
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
  /** Image URLs from the body (captured during on-device parsing; items parsed by the backend may not have this field). */
  images?: string[]
  /** Local file paths, the same length as images; an empty string means that one never reached disk. */
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
  /** How it matched: literally, or only content with a similar meaning was found. */
  match_kind?: 'literal' | 'semantic'
  /** Failure reason, used in the list to spell out "why nothing was read". */
  parse_error_code?: string | null
  saved_at: string
  parse_status: ParseStatus
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}

// Platform-agnostic runtime constants and utilities shared by web and mobile; importing DOM or native APIs is forbidden.
export * from './format'
export * from './errors'
