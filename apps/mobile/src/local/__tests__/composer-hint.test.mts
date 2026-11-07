import assert from 'node:assert/strict'
import { composerHint } from '../composer-hint'

const labels = { aiLink: '这是链接 · 存进收藏，不问 AI' }
let passed = 0
function check(name: string, actual: string, expected: string) {
  assert.equal(actual, expected, `${name}: 期望「${expected}」，实际「${actual}」`)
  passed += 1
}

// It only speaks when AI is on + the input is a link
check('AI 开 + 链接', composerHint({ ask: true, saveMode: true, error: null }, labels), labels.aiLink)
// The other three cases keep quiet
check('AI 开 + 句子', composerHint({ ask: true, saveMode: false, error: null }, labels), '')
check('AI 关 + 链接', composerHint({ ask: false, saveMode: true, error: null }, labels), '')
check('AI 关 + 句子', composerHint({ ask: false, saveMode: false, error: null }, labels), '')
// Errors take precedence and have to be said in any state
check('链接不合法', composerHint({ ask: true, saveMode: true, error: '这不是一个有效链接' }, labels), '这不是一个有效链接')
check('保存失败', composerHint({ ask: false, saveMode: true, error: '保存没有完成' }, labels), '保存没有完成')

console.log(`composer 提示：${passed} 项通过`)
