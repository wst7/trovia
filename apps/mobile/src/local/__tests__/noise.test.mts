/**
 * Regression test for trimming shell content off both ends of an article body.
 * It uses short markdown snippets in realistic shape, covering navigation, echoed titles, footer terms and tag clouds, plus
 * the red line that the body must never be stripped empty.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/noise.test.mts
 */
import assert from 'node:assert/strict'
import { trimMarkdownEdges } from '../noise.ts'

// 1. Header: logo image + navigation list + echoed title + author name
const wechatLike = [
  '![站点 logo](https://x.com/logo.png)',
  '',
  '- 首页',
  '- 物种日历',
  '- 吃货研究所',
  '',
  '我们为什么要睡觉？',
  '',
  '苏木七',
  '',
  '睡眠这件事儿，耗去了我们的小半生。',
  '',
  '有人会说，睡觉是为了让身体休息。',
].join('\n')
const trimmed = trimMarkdownEdges(wechatLike, '我们为什么要睡觉？| 果壳 科技有意思')
assert.ok(trimmed.startsWith('睡眠这件事儿'), `头部应剥到正文，实际：${trimmed.slice(0, 20)}`)
assert.ok(!trimmed.includes('物种日历'), '导航不该留下')
assert.ok(!trimmed.includes('苏木七'), '作者署名不该留下')
console.log('✓ 头部：logo、导航、标题回显、作者名都被剥掉')

// 2. Sub-headings must be kept ("foreword" is short, but it is structure)
const withHeading = ['## **前言**', '', '页面的性能优化对于前端来说永远是离不开的课题，需要结合网络、浏览器、框架多方面考虑。'].join('\n')
assert.ok(trimMarkdownEdges(withHeading, '前端性能优化').startsWith('## **前言**'), '小标题不能被当成标签剥掉')
console.log('✓ 小标题（前言）保留')

// 3. A column line in the header (with a link and a very long URL)
const columnLine = [
  '文章被收录于专栏：[前端Q](https://cloud.tencent.com/developer/column/94312)',
  '',
  '## 正文',
  '',
  '这里是比较长的正文内容，讲的是性能优化应该怎么做，而不是堆指标。',
].join('\n')
assert.ok(trimMarkdownEdges(columnLine, '前端').startsWith('## 正文'), '专栏行应被剥掉')
console.log('✓ 专栏行按「去掉 URL 后的字数」判断，不会被长链接撑过阈值')

// 4. Footer: copyright notice, report link, tag cloud
const tail = [
  '正文最后一段，讲完了所有的要点，读到这里应该已经明白了。',
  '',
  '发布于2013-10-30， 本文版权属于果壳网（guokr.com），禁止转载。',
  '',
  '举报这篇文章',
  '',
  '科学人',
  '',
  '观点',
  '',
  '医学',
].join('\n')
const tailTrimmed = trimMarkdownEdges(tail, '我们为什么要睡觉？')
assert.ok(tailTrimmed.endsWith('读到这里应该已经明白了。'), `尾部应剥干净，实际结尾：${tailTrimmed.slice(-24)}`)
console.log('✓ 尾部：版权、举报、标签云被剥掉，正文结尾完整')

// 5. Echoed title (with the site name trimmed off)
const echoTitle = ['VMware 到底值不值得用', '', '最近有不少人问我这个问题，我把它整理成一篇比较完整的回答。'].join('\n')
assert.ok(trimMarkdownEdges(echoTitle, 'VMware 到底值不值得用 - 少数派').startsWith('最近有不少人'), '标题回显应被剥掉')
console.log('✓ 标题回显（原标题带站点后缀）能识别')

// 6. The red line: a whole page that looks like shell must not be deleted to empty
const allShell = ['发布于', '', '举报', '', '分享'].join('\n')
assert.equal(trimMarkdownEdges(allShell, '标题'), allShell, '整篇都是外壳时保持原样，不能返回空')
console.log('✓ 整篇像外壳时保持原样，不会删空')

// 7. Pure body text is unaffected
const plain = '第一段讲的是原因，需要结合上下文理解。\n\n第二段讲的是结果，给出了具体数字和结论。'
assert.equal(trimMarkdownEdges(plain, '随便一个标题'), plain, '正文不该被改动')
console.log('✓ 普通正文原样保留')

console.log('\n全部通过：两头清理只剥外壳，不碰正文与小标题')
