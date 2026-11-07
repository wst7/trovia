import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

/**
 * The LLM is an “optional enhancement”, not a prerequisite for running:
 * with nothing configured it uses extractive summaries (sentences taken from the original text); only when configured does it call the user's own
 * OpenAI-compatible service. The key only goes into SecureStore, never into AsyncStorage and never into logs.
 */
export interface LlmConfig {
  enabled: boolean
  baseUrl: string
  model: string
  /** Use the model to understand search intent such as “find me yesterday's”, on by default. */
  intent: boolean
  /** Embedding model: semantic fallback when literal matching finds nothing; leave it empty to turn semantic search off. */
  embedModel: string
  semantic: boolean
}

export interface LlmState extends LlmConfig {
  hasKey: boolean
}

export const DEFAULT_LLM: LlmConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  intent: true,
  embedModel: 'text-embedding-3-small',
  semantic: true,
}

const CONFIG_KEY = 'trovia.llm.v1'
const SECRET_KEY = 'trovia.llm.key.v1'
// The key from before the rename: read once, and migrate to the new key when found. A model the user configured must not be lost over a rename.
const LEGACY_CONFIG_KEY = 'xunji.llm.v1'
const LEGACY_SECRET_KEY = 'xunji.llm.key.v1'
const TIMEOUT_MS = 30_000

/** Old storage key → new key. When the old value is read it is written back to the new key on the way, so the old one is not read again. */
async function readMigrated(key: string, legacyKey: string): Promise<string | null> {
  const current = await AsyncStorage.getItem(key)
  if (current) return current
  const legacy = await AsyncStorage.getItem(legacyKey)
  if (!legacy) return null
  await AsyncStorage.setItem(key, legacy).catch(() => undefined)
  await AsyncStorage.removeItem(legacyKey).catch(() => undefined)
  return legacy
}

export async function loadLlmState(): Promise<LlmState> {
  const [raw, key] = await Promise.all([
    readMigrated(CONFIG_KEY, LEGACY_CONFIG_KEY),
    loadLlmKey(),
  ])
  let parsed: Partial<LlmConfig> = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<LlmConfig>
    } catch {
      parsed = {}
    }
  }
  return {
    enabled: parsed.enabled === true,
    baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : DEFAULT_LLM.baseUrl,
    model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_LLM.model,
    intent: parsed.intent !== false,
    embedModel: typeof parsed.embedModel === 'string' ? parsed.embedModel : DEFAULT_LLM.embedModel,
    semantic: parsed.semantic !== false,
    hasKey: Boolean(key),
  }
}

export async function saveLlmState(config: LlmConfig, apiKey?: string): Promise<void> {
  const next: LlmConfig = {
    enabled: config.enabled,
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    model: config.model.trim(),
    intent: config.intent !== false,
    embedModel: config.embedModel.trim(),
    semantic: config.semantic !== false,
  }
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  if (apiKey !== undefined) {
    if (apiKey.trim()) await SecureStore.setItemAsync(SECRET_KEY, apiKey.trim())
    else await SecureStore.deleteItemAsync(SECRET_KEY)
  }
}

export async function loadLlmKey(): Promise<string | null> {
  try {
    const current = await SecureStore.getItemAsync(SECRET_KEY)
    if (current) return current
    const legacy = await SecureStore.getItemAsync(LEGACY_SECRET_KEY)
    if (!legacy) return null
    await SecureStore.setItemAsync(SECRET_KEY, legacy)
    await SecureStore.deleteItemAsync(LEGACY_SECRET_KEY).catch(() => undefined)
    return legacy
  } catch {
    return null
  }
}

/**
 * Local services (Ollama, LM Studio, vLLM on the LAN) usually do not check the key.
 * These addresses are allowed to leave it blank, otherwise the “run the model on your own computer” route would be walled off by a required field.
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|192\.168\.|\b10\.\d+\.\d+\.\d+|\.local\b/i.test(baseUrl)
}

function endpointOf(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

/** One JSON-friendly completion; intent parsing reuses it with a shorter timeout than summarization. */
export async function chat(
  config: LlmConfig,
  key: string,
  messages: unknown[],
  maxTokens: number,
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpointOf(config.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const hint = response.status === 401 || response.status === 403
        ? '密钥无效或没有权限'
        : response.status === 404
          ? '地址或模型名不对'
          : response.status === 429
            ? '请求太频繁或额度用完了'
            : '服务返回了错误'
      throw new Error(`${hint}（HTTP ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}）`)
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content || !content.trim()) throw new Error('服务没有返回内容')
    return content
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ChatTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatStep {
  /** What the model has to say; usually empty when it is calling a tool. */
  content: string | null
  toolCalls: ChatToolCall[]
}

/**
 * One step with tools. Tool calls have to be passed back to the model verbatim, so chat()'s “text only” path cannot be reused.
 * The timeout is counted per step: one question-and-answer may go three or four steps.
 */
export async function chatStep(
  config: LlmConfig,
  key: string,
  messages: ChatMessage[],
  tools: ChatTool[],
  maxTokens: number,
  timeoutMs = 60_000,
): Promise<ChatStep> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpointOf(config.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        tools,
        tool_choice: 'auto',
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const hint =
        response.status === 401 || response.status === 403
          ? '密钥无效或没有权限'
          : response.status === 404
            ? '地址或模型名不对'
            : response.status === 429
              ? '请求太频繁或额度用完了'
              : '服务返回了错误'
      throw new Error(`${hint}（HTTP ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}）`)
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ChatToolCall[] } }[]
    }
    const message = payload.choices?.[0]?.message
    const calls = Array.isArray(message?.tool_calls) ? message!.tool_calls.filter((c) => c?.function?.name) : []
    return { content: message?.content ?? null, toolCalls: calls }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export interface SummaryResult {
  summary: string
  keywords: string[]
}

function parseSummary(raw: string): SummaryResult | null {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      summary?: unknown
      keywords?: unknown
    }
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean).slice(0, 6)
      : []
    if (!summary) return null
    return { summary, keywords }
  } catch {
    return null
  }
}

/** Write the summary with the model the user configured; returns null when disabled or on a failed call, and the caller falls back to extractive. */
export async function summarizeWithLlm(input: {
  title: string
  url: string
  text: string
}): Promise<SummaryResult | null> {
  try {
    const state = await loadLlmState()
    if (!state.enabled) return null
    const key = await loadLlmKey()
    if (!key) return null

    const raw = await chat(
      state,
      key,
      [
        {
          role: 'system',
          content: '你是个人知识库的摘要助手。只根据用户给的正文写作，不补充正文里没有的信息。',
        },
        {
          role: 'user',
          content: [
            `标题：${input.title || '（无标题）'}`,
            `链接：${input.url}`,
            '',
            '正文：',
            input.text.slice(0, 12_000),
            '',
            '请输出一个 JSON 对象，格式为 {"summary":"2 到 3 句中文摘要","keywords":["3 到 6 个关键词"]}。',
          ].join('\n'),
        },
      ],
      600,
    )
    return parseSummary(raw)
  } catch {
    return null
  }
}

/** The settings page's “test connection”: returns the model's actual reply and throws an Error carrying the reason on failure. */
export async function testLlmConnection(config: LlmConfig, apiKey: string): Promise<string> {
  const key = apiKey.trim() || (await loadLlmKey())
  if (!key) throw new Error('还没有填写 API Key')
  if (!config.baseUrl.trim()) throw new Error('还没有填写服务地址')
  if (!config.model.trim()) throw new Error('还没有填写模型名')
  const reply = await chat(config, key, [{ role: 'user', content: '只回复两个字：可用' }], 16)
  return reply.trim().slice(0, 40)
}
