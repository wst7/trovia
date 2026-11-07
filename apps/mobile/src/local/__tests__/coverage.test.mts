/**
 * Regression test for the relevance threshold. The cases are taken from queries that really did show up on a device.
 * How to run: npx tsx apps/mobile/src/local/__tests__/coverage.test.mts
 */
import assert from 'node:assert/strict'
import { passesCoverage, requiredCoverage } from '../coverage.ts'

assert.equal(requiredCoverage(0), 0, '没有关键词不设门槛')
assert.equal(requiredCoverage(1), 1)
assert.equal(requiredCoverage(2), 1)
assert.equal(requiredCoverage(3), 2)
assert.equal(requiredCoverage(4), 2, '四个词要对上两个')

// Real case: a noisy query (“zzzz + that sort of thing”) splits into several terms and grazes only “that sort”
assert.equal(passesCoverage(1, 4), false, '只对上一个泛词不算相关')
// Normal case: the bigrams of the query “delayed queue” are almost all present in the article that was hit
assert.equal(passesCoverage(4, 4), true)
// Normal case: the query is “delayed queue redis” while the article only covers delayed queues
assert.equal(passesCoverage(4, 5), true, '整段命中时覆盖率天然够高')
// A single term
assert.equal(passesCoverage(1, 1), true)
assert.equal(passesCoverage(0, 1), false)
console.log('✓ 门槛：泛词单命中被挡、整段命中放行、单词查询正常')
