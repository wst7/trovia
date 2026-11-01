import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

/**
 * 大模型是「可选的增强」，不是运行前提：
 * 没配置时用抽取式摘要（原文里的句子），配了才调用用户自己的
 * OpenAI 兼容服务。密钥只进 SecureStore，不写 AsyncStorage、不进日志。
 */
export interface LlmConfig {
  enabled: boolean
  baseUrl: string
  model: string
  /** 用模型理解「找找昨天的」这类搜索意图，默认开启。 */
  intent: boolean
}

export interface LlmState extends LlmConfig {
  hasKey: boolean
}

export const DEFAULT_LLM: LlmConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  intent: true,
}

const CONFIG_KEY = 'xunji.llm.v1'
const SECRET_KEY = 'xunji.llm.key.v1'
const TIMEOUT_MS = 30_000

export async function loadLlmState(): Promise<LlmState> {
  const [raw, key] = await Promise.all([AsyncStorage.getItem(CONFIG_KEY), loadLlmKey()])
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
    hasKey: Boolean(key),
  }
}

export async function saveLlmState(config: LlmConfig, apiKey?: string): Promise<void> {
  const next: LlmConfig = {
    enabled: config.enabled,
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    model: config.model.trim(),
    intent: config.intent !== false,
  }
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  if (apiKey !== undefined) {
    if (apiKey.trim()) await SecureStore.setItemAsync(SECRET_KEY, apiKey.trim())
    else await SecureStore.deleteItemAsync(SECRET_KEY)
  }
}

export async function loadLlmKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECRET_KEY)
  } catch {
    return null
  }
}

function endpointOf(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

/** 一次 JSON 友好的补全；意图解析复用它，超时比摘要短。 */
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

/** 用用户自己配置的模型写摘要；未启用或调用失败返回 null，由调用方退回抽取式。 */
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

/** 设置页的「测试连接」：返回模型的实际回复，失败时抛出带原因的 Error。 */
export async function testLlmConnection(config: LlmConfig, apiKey: string): Promise<string> {
  const key = apiKey.trim() || (await loadLlmKey())
  if (!key) throw new Error('还没有填写 API Key')
  if (!config.baseUrl.trim()) throw new Error('还没有填写服务地址')
  if (!config.model.trim()) throw new Error('还没有填写模型名')
  const reply = await chat(config, key, [{ role: 'user', content: '只回复两个字：可用' }], 16)
  return reply.trim().slice(0, 40)
}
