/**
 * 发版前的真机前哨：拿几个真实站点跑一遍抓取与解析。
 *
 * 单测只能证明「逻辑没写错」，证明不了「微信今天还让我们读」。
 * 每次发版前跑一次，掉下来的站点会在下面直接列出来。
 *
 *   npm run smoke            # 默认清单
 *   npm run smoke -- <url>   # 只跑某一条
 */
import { fetchArticle } from '../src/local/article'

// 这个 tsconfig 没有 node 类型：脚本里用到的两个全局自己声明一下。
declare const process: { argv: string[]; exit(code: number): void }

interface Case {
  url: string
  label: string
  /** 站点自己的 5xx / 网络抖动：只提醒，不拦发版。 */
  flaky?: boolean
  /** 这个站点至少要有多少正文字符，才算真读到了。 */
  minChars?: number
  /** 站点本身时好时坏，失败只提醒不拦发版。 */
  optional?: boolean
}

const CASES: Case[] = [
  {
    label: '微信公众号',
    url: 'https://mp.weixin.qq.com/s/sgHX2VxtrNbyesXn-mzZqQ',
    minChars: 300,
  },
  { label: '少数派', url: 'https://sspai.com/post/73145', minChars: 800 },
  { label: '掘金', url: 'https://juejin.cn/post/7433790333576822784', minChars: 500 },
  { label: 'CSDN', url: 'https://blog.csdn.net/weixin_44707404/article/details/106360770', minChars: 500, flaky: true },
  { label: 'GitHub', url: 'https://github.com/facebook/react', minChars: 200 },
  { label: 'V2EX', url: 'https://v2ex.com/t/1254622', minChars: 100, optional: true },
  { label: 'Martin Fowler', url: 'https://martinfowler.com/articles/patterns-of-distributed-systems/', minChars: 1500 },

  // 外网常读的几类页面：百科、聚合站、开发者社区、老牌媒体、个人博客。
  { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)', minChars: 3000 },
  // HN 与 Ars 会按来源 IP 变脸：GitHub 的数据中心 IP 常被 HN 回 419，
  // 我这边的出口又读不到 Ars。两个都只记录，不拦发版。
  { label: 'Hacker News（419 视网络）', url: 'https://news.ycombinator.com/item?id=38000000', minChars: 200, optional: true },
  { label: 'DEV', url: 'https://dev.to/', minChars: 1000 },
  { label: 'BBC', url: 'https://www.bbc.com/news', minChars: 1000 },
  { label: 'The Guardian', url: 'https://www.theguardian.com/international', minChars: 1500 },
  { label: 'Simon Willison', url: 'https://simonwillison.net/', minChars: 1500 },
  { label: 'Paul Graham', url: 'https://paulgraham.com/greatwork.html', minChars: 3000 },

  // 推文走 oembed / syndication，正文本来就短，门槛按「有没有字」定。
  { label: 'X 推文', url: 'https://x.com/jack/status/20', minChars: 20 },

  // 已知被挡的站点：列在这里是为了「哪天通了」能被发现，不拦发版。
  { label: 'Reddit（需登录）', url: 'https://www.reddit.com/r/programming/comments/1g0k8zj/', minChars: 300, optional: true },
  { label: 'Ars Technica（视网络）', url: 'https://arstechnica.com/', minChars: 800, optional: true },
  {
    label: 'Stack Overflow（403）',
    url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
    minChars: 500,
    optional: true,
  },
]

const args = process.argv.slice(2)
const cases = args.length > 0 ? args.map((url: string) => ({ url, label: url })) : CASES

const rows: Array<{ label: string; ok: boolean; detail: string; optional: boolean }> = []

/** 5xx 与网络错误是站点自己的事，不是我们的回归；403/404/空正文才是。 */
function isTransient(message: string): boolean {
  return /HTTP 5\d\d|fetch failed|aborted|ECONNRESET|ETIMEDOUT|socket/i.test(message)
}

async function attempt(url: string) {
  const started = Date.now()
  const article = await fetchArticle(url)
  return { article, ms: Date.now() - started }
}

for (const item of cases) {
  let lastError: unknown = null
  let done = false
  // 一次重试：站点的 5xx 多半是几秒的事，直接判死会误伤发版。
  for (let round = 0; round < 2 && !done; round += 1) {
    try {
      const { article, ms } = await attempt(item.url)
      const chars = article.plainText.trim().length
      const need = item.minChars ?? 300
      const ok = !article.blocked && chars >= need && Boolean(article.title)
      rows.push({
        label: item.label,
        ok,
        optional: Boolean(item.optional),
        detail: ok
          ? `${chars} 字 · ${article.images.length} 图 · ${ms}ms`
          : article.blocked
            ? `被挡住（blocked）· ${chars} 字`
            : `正文只有 ${chars} 字（要 ≥${need}）· 标题「${article.title}」`,
      })
      done = true
    } catch (error) {
      lastError = error
      if (round === 0) await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  if (!done) {
    const message = lastError instanceof Error ? lastError.message : String(lastError)
    rows.push({
      label: item.label,
      ok: false,
      // 5xx / 网络问题只当提醒；403、404、空正文才算我们这边退步了。
      optional: Boolean(item.optional) || item.flaky || isTransient(message),
      detail: `抓取失败：${message}`,
    })
  }
}

const width = Math.max(...rows.map((r) => r.label.length), 10)
for (const row of rows) {
  const mark = row.ok ? '✓' : row.optional ? '△' : '✗'
  console.log(`${mark} ${row.label.padEnd(width)}  ${row.detail}`)
}

const failed = rows.filter((r) => !r.ok && !r.optional)
if (failed.length > 0) {
  console.log(`\n${failed.length}/${rows.length} 个站点没读通——先修再发版。`)
  process.exit(1)
}
const skipped = rows.filter((r) => !r.ok && r.optional).length
console.log(
  `\n${rows.length - skipped} 个站点读通${skipped > 0 ? `，${skipped} 个可选项没通（不拦发版）` : ''}。`,
)
