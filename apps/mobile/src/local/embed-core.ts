/**
 * The pure logic of semantic search: request embeddings, compute similarity, rank.
 *
 * Deliberately no react-native / sqlite / AsyncStorage, so it runs directly under Node in tests
 * — the things that break most often in the vector path are exactly "return order", "normalization" and "thresholds", so they must be unit-testable.
 */
export interface EmbedConfig {
  baseUrl: string
  model: string
  key: string
}

const TIMEOUT_MS = 12_000
/**
 * Similarity thresholds. Measured with qwen3-embedding, related sentences land at 0.36–0.51 and unrelated at 0.17–0.35,
 * different models spread very differently, so a single fixed value is not enough:
 *   - absolute floor 0.30: measured related 0.33–0.51, unrelated 0.17–0.35, and the two overlap,
 *     so the floor only removes the obviously unrelated; real noise is handled by the relative margin below;
 *   - relative margin: keep only those within margin of the top score, so the list isn't padded with noise.
 */
/**
 * Absolute floor for a semantic hit.
 *
 * This number is not a guess; it was measured on a device with 309 real saved items (qwen3-embedding):
 *   a real hit for "delayed queue" peaks at 0.47
 *   with no match, "quantum entanglement" scores 0.42, "will it rain tomorrow" 0.41, "zzzz…" 0.41
 * 0.30 would let queries like the latter reliably get five "roughly similar" hits, which costs more trust than saying "not found";
 * 0.45 keeps the noise out while keeping real semantic hits. Re-measure after switching embedding models.
 */
export const SEMANTIC_MIN_SCORE = 0.45
export const SEMANTIC_RELATIVE_MARGIN = 0.05

export function embeddingEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (base.endsWith('/embeddings')) return base
  return `${base}/embeddings`
}

/** Fetch vectors in bulk; the server doesn't guarantee order, so results are filled in by index. */
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

/** Text handed to the model: title + summary + keywords + the start of the body, capped at 2000 characters. */
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
 * Rank + filter: drop anything below the floor, anything too far from the top score, anything already shown.
 * Score everything before deciding the cutoff, because the top score is itself what relevance is judged against.
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
