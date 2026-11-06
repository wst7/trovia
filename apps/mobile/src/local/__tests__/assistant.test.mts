/**
 * 「问模型」的回归测试：不联网，注入一个假的模型来跑工具循环。
 *
 * 要守住的三件事：
 *   1. 模型要工具时真的执行了工具，结果回了上下文；
 *   2. 最后拿到的是模型的话，不是工具原文；
 *   3. 轮次/调用次数有上限，模型耍赖也不会死循环。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/assistant.test.mts
 */
import assert from 'node:assert/strict'

import { askLibrary, citationsFrom } from '../assistant.ts'
import type { ChatMessage, ChatStep } from '../llm.ts'
import { parseToolArguments } from '../tool-args.ts'
import type { ToolRunResult } from '../assistant-tools.ts'

/** 假模型：第一轮要检索，第二轮要读正文，第三轮直接回答。 */
function scriptedModel(): (messages: ChatMessage[]) => Promise<ChatStep> {
  let round = 0
  return async (messages) => {
    round += 1
    if (round === 1) {
      return {
        content: null,
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'search_library', arguments: '{"query":"画风"}' } },
        ],
      }
    }
    if (round === 2) {
      const toolMessage = messages.filter((m) => m.role === 'tool').at(-1)
      assert.ok(String(toolMessage?.content).includes('doc-a'), '检索结果必须回填进上下文')
      return {
        content: null,
        toolCalls: [
          { id: 'c2', type: 'function', function: { name: 'read_document', arguments: '{"id":"doc-a"}' } },
        ],
      }
    }
    return { content: '收藏里有一篇讲画风的 [1]，里面列了 19 套画风。', toolCalls: [] }
  }
}

const fakeRun = async (name: string, args: Record<string, unknown>): Promise<ToolRunResult> => {
  if (name === 'search_library') {
    assert.equal(args.query, '画风')
    return {
      content: JSON.stringify([
        { id: 'doc-a', title: '画风 skill：19 套手绘画风', site: 'mp.weixin.qq.com', saved_at: '2026-11-05' },
      ]),
      ids: ['doc-a'],
    }
  }
  if (name === 'read_document') {
    assert.equal(args.id, 'doc-a')
    return { content: JSON.stringify({ id: 'doc-a', title: '画风 skill：19 套手绘画风', text: '…' }), ids: ['doc-a'] }
  }
  return { content: '{"error":"不该调用"}', ids: [] }
}

const steps: string[] = []
const result = await askLibrary('我存过讲画风的文章吗？', {
  step: scriptedModel(),
  run: fakeRun,
  onStep: (step) => steps.push(step.name),
})

assert.equal(steps.join(','), 'search_library,read_document', '两步工具都该执行')
assert.ok(result.answer.includes('[1]'), '回答要保留引用标记')
assert.equal(result.citations.length, 1, '同一篇不该重复占两行')
assert.equal(result.citations[0].id, 'doc-a')
assert.equal(result.citations[0].site, 'mp.weixin.qq.com')

// 模型一直要工具：跑到上限就收手，不能无限循环
let endless = 0
const greedy = async (): Promise<ChatStep> => {
  endless += 1
  return {
    content: null,
    toolCalls: [
      { id: `loop-${endless}`, type: 'function', function: { name: 'library_stats', arguments: '{}' } },
    ],
  }
}
const guarded = await askLibrary('库存多少', {
  step: greedy,
  run: async () => ({ content: '{"total":314}', ids: [] }),
  maxRounds: 3,
  maxToolCalls: 4,
})
assert.ok(endless <= 4, `最多 4 次模型调用，实际 ${endless}`)
assert.ok(guarded.answer.length > 0, '用尽轮次也要给出答复兜底')

// 引用解析：坏 JSON / 非数组 / 重复都不炸
assert.deepEqual(citationsFrom('不是 json', []), [])
assert.equal(citationsFrom(JSON.stringify({ id: 'x', title: 't' }), []).length, 1)
assert.equal(
  citationsFrom(JSON.stringify([{ id: 'x', title: 't' }, { id: 'x', title: 't' }]), []).length,
  1,
  '同一 id 只留一条',
)

// 工具参数：小模型会给带前言/尾逗号的 JSON
assert.deepEqual(parseToolArguments('{"query":"画风",}'), { query: '画风' })
assert.deepEqual(parseToolArguments('调用 search_library({"query":"模型"})'), { query: '模型' })
assert.deepEqual(parseToolArguments(''), {})

console.log('问模型：工具循环、引用、上限与参数容错全部通过 ✓')
