/**
 * Regression test for query-term extraction and “is there any content word”.
 * How to run: npx tsx apps/mobile/src/local/__tests__/terms.test.mts
 */
import assert from 'node:assert/strict'
import { hasContentTerm, queryTerms } from '../terms.ts'

const terms = queryTerms('延时队列')
assert.ok(terms.includes('延时') && terms.includes('时队') && terms.includes('队列'), '中文仍拆二元组')
console.log('✓ 二元组行为没变')

assert.equal(hasContentTerm('延时队列'), true, '实词查询要放行')
assert.equal(hasContentTerm('Rust trait'), true, '英文查询要放行')
assert.equal(hasContentTerm('量子纠缠 装修报价'), true, '两个实词短语也要放行（噪声由分数线管）')
assert.equal(hasContentTerm(''), false)
assert.equal(hasContentTerm('没有这种东西'), false, '只剩虚词碎片时不许做语义兜底')
// The “zzzz” in “zzzz + that sort of thing” is Latin letters, and the function cannot tell whether it is garbage —
// that kind of thing is the job of the semantic score threshold, see the threshold in embed-core.ts.
assert.equal(hasContentTerm('zzzz没有这种东西'), true)
assert.equal(hasContentTerm('怎么 什么 这个 东西'), false, '全是虚词')
assert.equal(hasContentTerm('我记得那篇'), false, '口头语不算实词')
console.log('✓ 实词/虚词判定符合预期')

// Function-word fragment: a bigram stitched from two function words (as in “that sort of thing”) should count as a fragment, not a content word
assert.equal(hasContentTerm('这种东西'), false)
console.log('✓ 虚词碎片被过滤')
