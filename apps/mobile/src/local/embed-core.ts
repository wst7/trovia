/**
 * 语义检索的纯逻辑：请求 embeddings、算相似度、排序。
 *
 * 刻意不引入 react-native / sqlite / AsyncStorage，这样能在 Node 里直接跑测试
 * ——向量这块最容易出错的恰恰是「返回顺序」「归一化」「阈值」，必须能单测。
 */
export interface EmbedConfig {
  baseUrl: string
  model: string
  key: string
}

const TIMEOUT_MS = 12_000
/**
 * 相似度门槛。实测（qwen3-embedding）相关句落在 0.36–0.51，不相关 0.17–0.35，
 * 不同模型分布差异很大，所以不能只用一个固定值：
 *   - 绝对下限 0.30：实测相关句 0.33–0.51、无关句 0.17–0.35，两者有重叠，
 *     所以下限只负责挡掉明显无关的，真正的噪声靠下面的相对差距控制；
 *   - 相对差距：只保留与最高分相差不超过 margin 的，避免为凑数带进噪声。
 */
export const SEMANTIC_MIN_SCORE = 0.3
export const SEMANTIC_RELATIVE_MARGIN = 0.05

export function embeddingEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (base.endsWith('/embeddings')) return base
  return `${base}/embeddings`
}

/** 批量取向量；服务端不保证顺序，所以按 index 回填。 */
export async function embedTexts(
  texts: string[],
  config: EmbedConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetchImpl(embeddingEndpoint(config.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, input: texts }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`embeddings ${response.status} ${detail.slice(0, 120)}`)
    }
    const payload = (await response.json()) as { data?: { index?: number; embedding?: number[] }[] }
    const rows = payload.data ?? []
    const out: Float32Array[] = new Array(texts.length)
    rows.forEach((row, position) => {
      const index = typeof row.index === 'number' ? row.index : position
      if (Array.isArray(row.embedding)) out[index] = Float32Array.from(row.embedding)
    })
    for (let i = 0; i < out.length; i += 1) {
      if (!out[i]) throw new Error('embeddings 返回数量不足')
    }
    return out
  } finally {
    clearTimeout(timer)
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 送进模型的文本：标题 + 摘要 + 关键词 + 正文前段，控制在 2000 字以内。 */
export function embeddingInputOf(doc: {
  title: string | null
  summary: string | null
  keywords: string[]
  plainText: string | null
}): string {
  return [doc.title ?? '', doc.summary ?? '', doc.keywords.join('、'), (doc.plainText ?? '').slice(0, 1200)]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000)
}

export interface RankedVector {
  id: string
  score: number
}

/**
 * 排序 + 过滤：低于门槛的丢掉，离最高分太远的丢掉，已经展示过的丢掉。
 * 先算全部再决定门槛，因为「最高分」本身是判断相关性的依据。
 */
export function rankBySimilarity(
  vectors: { id: string; vec: Float32Array }[],
  query: Float32Array,
  options: { exclude?: Set<string>; limit?: number; minScore?: number; margin?: number } = {},
): RankedVector[] {
  const {
    exclude = new Set<string>(),
    limit = 5,
    minScore = SEMANTIC_MIN_SCORE,
    margin = SEMANTIC_RELATIVE_MARGIN,
  } = options

  const scored: RankedVector[] = []
  for (const row of vectors) {
    if (exclude.has(row.id)) continue
    scored.push({ id: row.id, score: cosine(query, row.vec) })
  }
  if (scored.length === 0) return []

  const best = Math.max(...scored.map((row) => row.score))
  const cutoff = Math.max(minScore, best - margin)
  return scored
    .filter((row) => row.score >= cutoff)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
