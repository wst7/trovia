/** Fetch one article and print the body paragraph by paragraph, for reading a WeChat article in full. */
import { extractFromHtml } from '../apps/mobile/src/local/article.ts'

const url = process.argv[2]
const from = Number(process.argv[3] ?? 0)
const count = Number(process.argv[4] ?? 40)

const html = await (
  await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    },
  })
).text()
const article = extractFromHtml(html, url)
const lines = article.markdown.split('\n').filter((line) => line.trim())
console.log('title:', article.title, '| paragraphs:', lines.length)
console.log(lines.slice(from, from + count).join('\n'))
