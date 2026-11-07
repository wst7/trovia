/**
 * Persistence and scheduling for supplementary semantic search. The pure computation lives in embed-core.ts; this file only handles:
 * reading the config, accumulating the items whose index still needs building, and storing/fetching vectors.
 *
 * Fallback only, never changing the primary ordering: literal hits always come first and semantic results are listed separately.
 */
import { getDb } from './db'
import {
  SEMANTIC_MIN_SCORE,
  cosine,
  embedTexts,
  embeddingEndpoint,
  embeddingInputOf,
  rankBySimilarity,
} from './embed-core'
import type { EmbedConfig, RankedVector } from './embed-core'
import { loadLlmKey, loadLlmState } from './llm'

export { SEMANTIC_MIN_SCORE, cosine, embedTexts, embeddingEndpoint, embeddingInputOf, rankBySimilarity }
export type { EmbedConfig, RankedVector }

/** Returns null when no model is configured, the switch is off, or there is no key — the caller uses that to skip semantic search entirely. */
export async function loadEmbedConfig(): Promise<EmbedConfig | null> {
  try {
    const state = await loadLlmState()
    if (!state.enabled || !state.semantic || !state.embedModel) return null
    const key = await loadLlmKey()
    if (!key) return null
    return { baseUrl: state.baseUrl, model: state.embedModel, key }
  } catch {
    return null
  }
}

function toBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength)
}

function fromBlob(blob: Uint8Array | ArrayBuffer): Float32Array {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob)
  // Copy it, so the data is not misaligned once the underlying ArrayBuffer gets reused.
  return new Float32Array(bytes.slice().buffer)
}

export async function saveVector(documentId: string, model: string, vec: Float32Array): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `INSERT INTO doc_vectors (document_id, model, dim, vec, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET model = excluded.model, dim = excluded.dim,
       vec = excluded.vec, updated_at = excluded.updated_at`,
    documentId,
    model,
    vec.length,
    toBlob(vec),
    new Date().toISOString(),
  )
}

/** For the settings page: how many items have an index / could have one. */
export async function vectorStats(model: string): Promise<{ indexed: number; total: number }> {
  const db = await getDb()
  const indexed = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM doc_vectors v JOIN documents d ON d.id = v.document_id WHERE v.model = ? AND d.deleted_at IS NULL',
    model,
  )
  const total = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM documents WHERE deleted_at IS NULL AND parse_status IN ('completed', 'partial')",
  )
  return { indexed: indexed?.count ?? 0, total: total?.count ?? 0 }
}

interface VectorRow {
  document_id: string
  vec: Uint8Array | ArrayBuffer
}

/** For search: read all vectors into memory (1000 articles at 384 dimensions is about 1.5MB). */
export async function loadVectors(model: string): Promise<{ id: string; vec: Float32Array }[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<VectorRow>(
    `SELECT v.document_id, v.vec FROM doc_vectors v
     JOIN documents d ON d.id = v.document_id
     WHERE v.model = ? AND d.deleted_at IS NULL`,
    model,
  )
  return rows.map((row) => ({ id: row.document_id, vec: fromBlob(row.vec) }))
}

interface PendingRow {
  id: string
  title: string | null
  summary_short: string | null
  summary_long: string | null
  keywords: string
  plain_text: string | null
}

function safeKeywords(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Items with no vector yet (or whose content has changed). */
export async function pendingVectorTargets(model: string, limit: number): Promise<{ id: string; text: string }[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<PendingRow>(
    `SELECT d.id, d.title, d.summary_short, d.summary_long, d.keywords, d.plain_text
     FROM documents d
     LEFT JOIN doc_vectors v ON v.document_id = d.id AND v.model = ?
     WHERE d.deleted_at IS NULL
       AND d.parse_status IN ('completed', 'partial')
       AND (v.document_id IS NULL OR v.updated_at < d.updated_at)
     ORDER BY d.updated_at DESC
     LIMIT ?`,
    model,
    limit,
  )
  return rows.map((row) => ({
    id: row.id,
    text: embeddingInputOf({
      title: row.title,
      summary: row.summary_long ?? row.summary_short,
      keywords: safeKeywords(row.keywords),
      plainText: row.plain_text,
    }),
  }))
}

/**
 * Backfill the index: at most limit articles at a time, 8 per batch, stopping on failure (pick it up next time) so the user is not disturbed.
 * Returns how many were created this time.
 */
export async function buildVectors(limit = 12, fetchImpl: typeof fetch = fetch): Promise<number> {
  const config = await loadEmbedConfig()
  if (!config) return 0
  const targets = await pendingVectorTargets(config.model, limit)
  if (targets.length === 0) return 0

  let done = 0
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8)
    try {
      const vectors = await embedTexts(
        batch.map((item) => item.text),
        config,
        fetchImpl,
      )
      for (let j = 0; j < batch.length; j += 1) {
        await saveVector(batch[j].id, config.model, vectors[j])
        done += 1
      }
    } catch {
      break // a network or quota problem: stop here and top it up next time
    }
  }
  return done
}
