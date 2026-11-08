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
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    // No embeddings endpoint: leave it empty rather than sending a model that will 404.
    embedModel: '',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    // Console credits: pay per use, full model list, OpenAI chat/completions
    // dialect under this path.
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    model: 'deepseek-v4.1-flash',
    embedModel: '',
    keyUrl: 'https://opencode.ai/console',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    // Subscription ($10/month and up) rather than credits, with its own path and
    // its own — smaller, open-model — list. Same Console key, different address:
    // pasting a Go key into the Zen address answers 401.
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    model: 'deepseek-v4.1-flash',
    embedModel: '',
    keyUrl: 'https://opencode.ai/console',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    embedModel: 'text-embedding-3-small',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
]

/** Which preset the current address belongs to, if any. Trailing slashes and case differ across users. */
export function matchPreset(baseUrl: string): LlmPreset | null {
  const normalized = baseUrl.trim().toLowerCase().replace(/\/+$/, '')
  if (!normalized) return null
  return LLM_PRESETS.find((preset) => preset.baseUrl.toLowerCase().replace(/\/+$/, '') === normalized) ?? null
}

/** The address a custom provider starts from: empty, so the fields are obviously the user's to fill. */
export const CUSTOM_PROVIDER_ID = 'custom'

/** True when the address is one the user typed rather than one of the presets. */
export function isCustomAddress(baseUrl: string): boolean {
  return baseUrl.trim().length > 0 && matchPreset(baseUrl) === null
}
