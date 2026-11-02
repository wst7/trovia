/**
 * 相关性门槛的回归测试。案例取自真机上真实出现过的查询。
 * 跑法：npx tsx apps/mobile/src/local/__tests__/coverage.test.mts
 */
import assert from 'node:assert/strict'
import { passesCoverage, requiredCoverage } from '../coverage.ts'

assert.equal(requiredCoverage(0), 0, '没有关键词不设门槛')
assert.equal(requiredCoverage(1), 1)
assert.equal(requiredCoverage(2), 1)
assert.equal(requiredCoverage(3), 2)
assert.equal(requiredCoverage(4), 2, '四个词要对上两个')

// 真实案例：查询「zzzz没有这种东西」拆出若干词，只蹭到「这种」
assert.equal(passesCoverage(1, 4), false, '只对上一个泛词不算相关')
// 正常案例：查询「延时队列」的二元组几乎都在命中文章里
assert.equal(passesCoverage(4, 4), true)
// 正常案例：查询「延时队列 redis」，文章只讲延时队列
assert.equal(passesCoverage(4, 5), true, '整段命中时覆盖率天然够高')
// 单个词
assert.equal(passesCoverage(1, 1), true)
assert.equal(passesCoverage(0, 1), false)
console.log('✓ 门槛：泛词单命中被挡、整段命中放行、单词查询正常')
