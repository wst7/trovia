/**
 * The outbox and the badge: what happens when a save cannot reach the cloud,
 * and what the user is told when they never opened the popup.
 *
 * How to run: npm test -w @trovia/extension
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { badgeFor, drop, enqueue, findSaved, pendingCount, rememberSaved } from '../src/queue.js'

const record = (id) => ({ id, payload: { url: `https://example.com/${id}`, title: id } })

test('排队：同一个链接重复失败只留一条', () => {
  let queue = []
  queue = enqueue(queue, record('w1'), 1)
  queue = enqueue(queue, record('w1'), 2)
  assert.equal(queue.length, 1)
  // 新的一次覆盖旧的一次：用户刚看到的标题才是要保存的
  assert.equal(queue[0].at, 2)
})

test('排队：不同链接各自保留，最新的在前', () => {
  let queue = []
  queue = enqueue(queue, record('w1'), 1)
  queue = enqueue(queue, record('w2'), 2)
  assert.deepEqual(queue.map((item) => item.record.id), ['w2', 'w1'])
})

test('排队：坏数据不会炸，容量有上限', () => {
  const fromNull = enqueue(null, record('w1'))
  assert.equal(fromNull.length, 1)
  assert.equal(fromNull[0].record.id, 'w1')
  let queue = []
  for (let i = 0; i < 260; i += 1) queue = enqueue(queue, record(`w${i}`), i)
  assert.equal(queue.length, 200)
})

test('队列计数与移除', () => {
  assert.equal(pendingCount(null), 0)
  assert.equal(pendingCount([{ record: record('w1') }]), 1)
  assert.deepEqual(drop([{ record: record('w1') }, { record: record('w2') }], 'w1').map((i) => i.record.id), ['w2'])
})

test('角标：成功打勾、失败打叹号、平时显示待发送数量', () => {
  assert.deepEqual(badgeFor({ justSaved: true }), { text: '✓', color: '#2f6b47' })
  assert.equal(badgeFor({ justFailed: true }).text, '!')
  assert.equal(badgeFor({ pending: 3 }).text, '3')
  assert.equal(badgeFor({}).text, '')
  // 失败优先于数量：先让用户知道刚才那次没成
  assert.equal(badgeFor({ justFailed: true, pending: 3 }).text, '!')
})

test('最近保存：同一条只留最新，最多 50 条', () => {
  let index = []
  index = rememberSaved(index, record('w1'), 1)
  index = rememberSaved(index, record('w2'), 2)
  index = rememberSaved(index, record('w1'), 3)
  assert.equal(index.length, 2)
  assert.equal(index[0].id, 'w1')
  assert.equal(index[0].at, 3)
  for (let i = 0; i < 80; i += 1) index = rememberSaved(index, record(`x${i}`), i)
  assert.equal(index.length, 50)
})

test('查重：能回答「这个页面是不是存过了」', () => {
  const index = rememberSaved([], record('w1'), 123)
  assert.equal(findSaved(index, 'w1').at, 123)
  assert.equal(findSaved(index, 'nope'), null)
  assert.equal(findSaved(null, 'w1'), null)
  assert.equal(findSaved(index, ''), null)
})
