/**
 * Built-in providers: the addresses must match exactly what users' pasted
 * values look like, because the picker lights up by comparing the address.
 *
 * How to run: npx tsx src/local/__tests__/llm-presets.test.mts
 */
import assert from 'node:assert/strict'

import { isCustomAddress, LLM_PRESETS, matchPreset } from '../llm-presets.ts'

// Every preset must be usable as-is.
for (const preset of LLM_PRESETS) {
  assert.ok(preset.baseUrl.startsWith('http'), `${preset.name} 缺地址`)
  assert.ok(preset.model.trim().length > 0, `${preset.name} 缺默认模型`)
  assert.match(preset.baseUrl, /\/v\d+$|compatible-mode\/v1$|paas\/v4$/, `${preset.name} 地址应以版本号结尾`)
}

// Lookup tolerates a trailing slash and different case, which is how pasted values arrive.
assert.equal(matchPreset('https://api.deepseek.com/v1')?.id, 'deepseek')
assert.equal(matchPreset('https://api.deepseek.com/v1/')?.id, 'deepseek')
assert.equal(matchPreset('  HTTPS://API.DEEPSEEK.COM/V1  ')?.id, 'deepseek')

// A self-hosted gateway is custom, and produces no key link.
assert.equal(matchPreset('https://llm.example.com/v1'), null)
assert.equal(isCustomAddress('https://llm.example.com/v1'), true)
assert.equal(isCustomAddress('https://api.deepseek.com/v1'), false)
assert.equal(isCustomAddress(''), false)

// Providers without an embeddings endpoint must not inherit one.
const deepseek = LLM_PRESETS.find((preset) => preset.id === 'deepseek')
assert.equal(deepseek?.embedModel, '')
const openai = LLM_PRESETS.find((preset) => preset.id === 'openai')
assert.equal(openai?.embedModel, 'text-embedding-3-small')

// Only the three built-in providers plus a custom option remain.
assert.deepEqual(
  LLM_PRESETS.map((preset) => preset.id),
  ['deepseek', 'opencode-zen', 'opencode-go', 'openai'],
)
// OpenCode serves an OpenAI-compatible dialect under its own path, and its
// console is where keys come from. No embeddings endpoint, so that field is
// empty rather than carrying another provider's model across.
const opencode = LLM_PRESETS.find((preset) => preset.id === 'opencode-zen')
assert.equal(opencode?.baseUrl, 'https://opencode.ai/inference/openai/v1')
assert.equal(opencode?.embedModel, '')
assert.ok(opencode?.keyUrl?.startsWith('https://opencode.ai/'))
assert.equal(matchPreset('https://opencode.ai/inference/openai/v1')?.id, 'opencode-zen')

// Go is a subscription with its own path; the two must not collapse into one
// chip, because a key for one does not work against the other's address.
const go = LLM_PRESETS.find((preset) => preset.id === 'opencode-go')
assert.equal(go?.baseUrl, 'https://opencode.ai/inference/go/openai/v1')
assert.equal(matchPreset('https://opencode.ai/inference/go/openai/v1')?.id, 'opencode-go')
assert.notEqual(go?.baseUrl, opencode?.baseUrl)

// A self-hosted server is still usable by typing its address, even though no
// preset ships for one any more.
assert.equal(matchPreset('http://localhost:11434/v1'), null)

console.log(`大模型服务商：${LLM_PRESETS.length} 个预设、地址匹配与本地判断通过`)
