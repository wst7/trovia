/**
 * Built-in providers.
 *
 * Without these the page opened on an empty address, a model name the user had
 * to know by heart, and a key field — three things most people cannot answer.
 * Picking a provider fills the address and a working default model, leaving only
 * the key to paste.
 *
 * Model names age; these are starting points, and every field stays editable.
 * A provider with no embeddings support leaves `embedModel` empty on purpose:
 * carrying OpenAI's embedding model over to DeepSeek would fail at request time.
 */
export interface LlmPreset {
  id: string
  /** Shown as-is: these are brand names, not copy to translate. */
  name: string
  baseUrl: string
  model: string
  embedModel: string
  /** Where the user creates the key. null for a local server, which needs none. */
  keyUrl: string | null
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    embedModel: 'text-embedding-3-small',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    // No embeddings endpoint: leave it empty rather than sending a model that will 404.
    embedModel: '',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    embedModel: '',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    embedModel: 'embedding-3',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'dashscope',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    embedModel: 'text-embedding-v3',
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    embedModel: 'BAAI/bge-m3',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    // Console speaks OpenAI's chat/completions dialect here; the same models are
    // also served under /anthropic and /google for other SDKs.
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    // Cheap and fast, which is what summarising a saved page needs.
    model: 'deepseek-v4.1-flash',
    // Console lists chat models only: no embeddings endpoint, so semantic search
    // needs a provider that has one.
    embedModel: '',
    keyUrl: 'https://opencode.ai/console',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    embedModel: '',
    keyUrl: 'https://openrouter.ai/keys',
  },
]

/** Which preset the current address belongs to, if any. Trailing slashes and case differ across users. */
export function matchPreset(baseUrl: string): LlmPreset | null {
  const normalized = baseUrl.trim().toLowerCase().replace(/\/+$/, '')
  if (!normalized) return null
  return LLM_PRESETS.find((preset) => preset.baseUrl.toLowerCase().replace(/\/+$/, '') === normalized) ?? null
}

/** True when the address is one the user typed rather than one of the presets. */
export function isCustomAddress(baseUrl: string): boolean {
  return baseUrl.trim().length > 0 && matchPreset(baseUrl) === null
}
