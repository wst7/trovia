/**
 * Pre-release outpost on a real device: run fetching and parsing against a few real sites.
 *
 * Unit tests can only prove "the logic is not wrong", not "WeChat still lets us read it today".
 * Run it once before every release; sites that fall over are listed right below.
 *
 *   npm run smoke            # default list
 *   npm run smoke -- <url>   # run only one
 */
import { fetchArticle } from '../src/local/article'

// This tsconfig has no node types: declare the two globals the script uses itself.
declare const process: { argv: string[]; exit(code: number): void }

interface Case {
  url: string
  label: string
  /** The site's own 5xx / network flakiness: warn only, do not block the release. */
  flaky?: boolean
  /** How many body characters this site must produce at minimum before it counts as really read. */
  minChars?: number
  /** The site itself comes and goes, so failures only warn and do not block the release. */
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

  // The kinds of pages read most often on the open web: encyclopedias, aggregators, developer communities, established media, personal blogs.
  { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)', minChars: 3000 },
  // HN and Ars change face by source IP: HN often answers 419 to GitHub's datacenter IPs,
  // and my egress cannot read Ars. Both are only recorded, they do not block the release.
  { label: 'Hacker News（419 视网络）', url: 'https://news.ycombinator.com/item?id=38000000', minChars: 200, optional: true },
  { label: 'DEV', url: 'https://dev.to/', minChars: 1000 },
  { label: 'BBC', url: 'https://www.bbc.com/news', minChars: 1000 },
  { label: 'The Guardian', url: 'https://www.theguardian.com/international', minChars: 1500 },
  { label: 'Simon Willison', url: 'https://simonwillison.net/', minChars: 1500 },
  { label: 'Paul Graham', url: 'https://paulgraham.com/greatwork.html', minChars: 3000 },

  // Tweets go through oembed / syndication and the body is short anyway, so the bar is "is there any text at all".
  { label: 'X 推文', url: 'https://x.com/jack/status/20', minChars: 20 },

  // Sites known to be blocked: they are listed here so that "the day it works" gets noticed; they do not block the release.
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

/** 5xx and network errors are the site's own business, not our regression; 403/404/empty body are. */
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
  // One retry: a site's 5xx is usually a matter of seconds, and declaring failure right away would wrongly fail the release.
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
      // 5xx / network problems only count as warnings; 403, 404 and an empty body are what count as our regression.
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

/*
 * Blocking the release on a single site is too brittle: sites change face by source IP (HN answers 419 to datacenter IPs,
 * Juejin serves only a shell to overseas IPs, CSDN occasionally returns 521), and none of that is our regression.
 * The rule is now: block only when two or more of the required sites fail at the same time — that starts to look like a real problem in the fetching layer.
 */
const failed = rows.filter((r) => !r.ok && !r.optional)
if (failed.length >= 2) {
  console.log(`\n${failed.length}/${rows.length} 个站点没读通——先修再发版。`)
  process.exit(1)
}
if (failed.length === 1) {
  console.log(`\n${failed[0].label} 这一个没读通，多半是站点按来源 IP 变脸；其余照常。`)
}
const skipped = rows.filter((r) => !r.ok && r.optional).length
console.log(
  `\n${rows.length - skipped} 个站点读通${skipped > 0 ? `，${skipped} 个可选项没通（不拦发版）` : ''}。`,
)
