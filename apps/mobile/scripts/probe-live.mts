/**
 * Batch extraction test against real articles.
 *
 * It does not start from hardcoded links; it first pulls each site's RSS to get article links that "really exist right now",
 * then runs the real extraction on each one. Sites behind a login wall or a human check are marked skip — those are not ours to fix.
 *
 * Usage:
 *   npx tsx scripts/probe-live.mts           # 2 articles per site
 *   npx tsx scripts/probe-live.mts 3         # 3 articles per site
 */
import { fetchArticle } from '../src/local/article'

interface Feed {
  name: string
  url: string
  /** Exclude navigation links, keep only articles. */
  articleMatch: RegExp
}

const FEEDS: Feed[] = [
  { name: '少数派', url: 'https://sspai.com/feed', articleMatch: /\/post\/\d+/ },
  { name: '掘金', url: 'https://juejin.cn/rss', articleMatch: /\/post\/\d+/ },
  { name: '爱范儿', url: 'https://www.ifanr.com/feed', articleMatch: /ifanr\.com\/\d+/ },
  { name: 'Solidot', url: 'https://www.solidot.org/index.rss', articleMatch: /solidot\.org\/story\?sid=\d+/ },
  { name: '开源中国', url: 'https://www.oschina.net/rss/news', articleMatch: /oschina\.net\/news\/\d+/ },
  { name: '博客园', url: 'https://www.cnblogs.com/rss', articleMatch: /cnblogs\.com\/.+\/p\/\d+/ },
  { name: 'SegmentFault', url: 'https://segmentfault.com/feeds', articleMatch: /segmentfault\.com\/a\/\d+/ },
  { name: 'InfoQ', url: 'https://www.infoq.cn/feed', articleMatch: /infoq\.cn\/article\/\w+/ },
  { name: 'IT之家', url: 'https://www.ithome.com/rss/', articleMatch: /ithome\.com\/\d+\/\d+\/\d+\.htm/ },
  { name: '虎嗅', url: 'https://www.huxiu.com/rss/0.xml', articleMatch: /huxiu\.com\/article\/\d+/ },
  { name: 'V2EX', url: 'https://www.v2ex.com/index.xml', articleMatch: /v2ex\.com\/t\/\d+/ },
]

const PER_FEED = Number(process.argv[2] ?? 2)
const TIMEOUT_MS = 20_000

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchFeed(feed: Feed): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        Accept: 'application/rss+xml,application/xml,text/xml,*/*',
      },
    })
    if (!response.ok) throw new Error(`feed ${response.status}`)
    const xml = await response.text()
    const links = [...xml.matchAll(/<link[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/link>/g)]
      .map((match) => match[1].trim())
      .filter((href) => /^https?:\/\//.test(href) && feed.articleMatch.test(href))
    return [...new Set(links)].slice(0, PER_FEED)
  } finally {
    clearTimeout(timer)
  }
}

interface Row {
  site: string
  url: string
  verdict: 'ok' | 'short' | 'empty' | 'blocked' | 'skip' | 'error'
  chars: number
  images: number
  note: string
}

function classify(chars: number, images: number, article: { blocked: boolean; appOnly: boolean; scriptOnly: boolean }): {
  verdict: Row['verdict']
  note: string
} {
  if (article.blocked) return { verdict: 'skip', note: '人机验证/登录墙，跳过' }
  if (article.appOnly) return { verdict: 'skip', note: '必须用对应 App 打开，跳过' }
  if (article.scriptOnly) return { verdict: 'error', note: '只拿到脚本外壳（可能需要渲染）' }
  if (chars >= 800) return { verdict: 'ok', note: '' }
  if (chars >= 200) return { verdict: 'short', note: '正文偏短' }
  return { verdict: 'empty', note: images > 0 ? '有图无字（可交给 OCR）' : '没有抓到正文' }
}

async function main() {
  const rows: Row[] = []

  for (const feed of FEEDS) {
    let urls: string[] = []
    try {
      urls = await fetchFeed(feed)
    } catch (error) {
      rows.push({
        site: feed.name,
        url: feed.url,
        verdict: 'error',
        chars: 0,
        images: 0,
        note: `RSS 取不到：${error instanceof Error ? error.message : 'unknown'}`,
      })
      continue
    }
    if (urls.length === 0) {
      rows.push({ site: feed.name, url: feed.url, verdict: 'error', chars: 0, images: 0, note: 'RSS 里没有文章链接' })
      continue
    }

    for (const url of urls) {
      try {
        const article = await fetchArticle(url)
        const chars = article.plainText.length
        const { verdict, note } = classify(chars, article.images.length, article)
        rows.push({ site: feed.name, url, verdict, chars, images: article.images.length, note })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown'
        // 403/412/404 is mostly anti-scraping or an expired link, not something we can fix
        const verdict: Row['verdict'] = /HTTP (403|412|404|451)/.test(message) ? 'skip' : 'error'
        rows.push({ site: feed.name, url, verdict, chars: 0, images: 0, note: message.slice(0, 40) })
      }
    }
  }

  const pad = (text: string, width: number) => {
    // Count a Chinese character as two positions so the table does not get misaligned
    let visual = 0
    for (const char of text) visual += /[\u4e00-\u9fa5]/.test(char) ? 2 : 1
    return text + ' '.repeat(Math.max(0, width - visual))
  }

  console.log(`\n${pad('站点', 12)}${pad('结果', 10)}${pad('字数', 8)}${pad('图', 5)}说明`)
  console.log('-'.repeat(78))
  for (const row of rows) {
    console.log(
      `${pad(row.site, 12)}${pad(row.verdict, 10)}${pad(String(row.chars), 8)}${pad(String(row.images), 5)}${row.note}`,
    )
    if (row.verdict !== 'ok') console.log(`${' '.repeat(12)}${row.url}`)
  }

  const counted = rows.filter((row) => row.verdict !== 'skip' || row.note.includes('RSS'))
  const ok = rows.filter((row) => row.verdict === 'ok').length
  const usable = rows.filter((row) => row.verdict === 'ok' || row.verdict === 'short').length
  const skipped = rows.filter((row) => row.verdict === 'skip').length
  console.log('-'.repeat(78))
  console.log(
    `可用 ${usable}/${counted.length}（其中 >=800 字 ${ok}），跳过 ${skipped} 条（登录墙/反爬/必须用 App 打开）`,
  )
  console.log(stripTags('') === '' ? '' : '')
}

await main()
