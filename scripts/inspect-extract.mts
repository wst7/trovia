/**
 * 用真实页面跑一遍正文抽取，看开头是不是还有站点残留。
 *
 * 跑法：npx tsx scripts/inspect-extract.mts <url>
 */
import { extractFromHtml } from '../apps/mobile/src/local/article.ts'

const url = process.argv[2]
if (!url) {
  console.error('用法：npx tsx scripts/inspect-extract.mts <url>')
  process.exit(1)
}

const response = await fetch(url, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  },
})
const html = await response.text()
const article = extractFromHtml(html, url)

console.log('status', response.status, 'html', html.length)
console.log('title', article.title)
console.log('markdown head:')
console.log(article.markdown.split('\n').slice(0, 14).join('\n'))
