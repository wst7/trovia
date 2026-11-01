/**
 * 竞品差评采集：App Store 评论（iTunes RSS）+ GitHub issue。
 *
 * 存在的意义：定位不是靠自我感觉，而是看别人被骂什么。
 * 走本机代理（127.0.0.1:7897），因为 iTunes/GitHub 直连不稳定。
 *
 * 跑法：npx tsx scripts/collect-competitor-voice.mts
 * 输出：/tmp/competitor-voice.json
 */
import { writeFile } from 'node:fs/promises'

const PROXY = process.env.HTTPS_PROXY ?? 'http://127.0.0.1:7897'

process.env.HTTPS_PROXY = PROXY
process.env.HTTP_PROXY = PROXY

interface Review {
  source: string
  app: string
  rating: number
  title: string
  text: string
  at: string
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return (await response.json()) as T
}

/** 先在 App Store 搜到 app id。 */
async function findAppId(term: string, country: string): Promise<{ id: string; name: string } | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=5`
  const data = await getJson<{ results: { trackId: number; trackName: string; trackViewUrl: string }[] }>(url)
  const hit = data.results.find((row) => row.trackName.toLowerCase().includes(term.split(' ')[0].toLowerCase()))
  return hit ? { id: String(hit.trackId), name: hit.trackName } : null
}

interface RssReview {
  'im:rating': { label: string }
  title: { label: string }
  content: { label: string }
  updated: { label: string }
}

/** RSS 评论最多给 10 页，每页 50 条；这里取最近 2 页。 */
async function fetchReviews(appId: string, country: string, appName: string): Promise<Review[]> {
  const out: Review[] = []
  for (const page of [1, 2]) {
    const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`
    try {
      const data = await getJson<{ feed: { entry?: RssReview[] | RssReview } }>(url)
      const entries = data.feed.entry
      const list = Array.isArray(entries) ? entries : entries ? [entries] : []
      for (const entry of list) {
        if (!entry['im:rating']) continue
        out.push({
          source: `appstore-${country}`,
          app: appName,
          rating: Number(entry['im:rating'].label),
          title: entry.title?.label ?? '',
          text: (entry.content?.label ?? '').slice(0, 400),
          at: entry.updated?.label ?? '',
        })
      }
    } catch {
      // 某一页取不到就跳过，不影响整体
    }
  }
  return out
}

interface Issue {
  number: number
  title: string
  comments: number
  reactions: { total_count: number }
  labels: { name: string }[]
  html_url: string
  created_at: string
}

/** GitHub 上被讨论最多的 open issue，往往就是用户真正的痛。 */
async function fetchIssues(repo: string, limit = 15): Promise<{ repo: string; issues: Issue[] }> {
  const url = `https://api.github.com/repos/${repo}/issues?state=open&sort=comments&direction=desc&per_page=${limit}`
  const rows = await getJson<(Issue & { pull_request?: unknown })[]>(url)
  return {
    repo,
    issues: rows
      .filter((row) => !row.pull_request)
      .map((row) => ({
        number: row.number,
        title: row.title,
        comments: row.comments,
        reactions: row.reactions,
        labels: row.labels ?? [],
        html_url: row.html_url,
        created_at: row.created_at,
      })),
  }
}

async function main() {
  const reviews: Review[] = []
  const targets: { term: string; country: string; name: string }[] = [
    { term: 'Cubox', country: 'cn', name: 'Cubox' },
    { term: 'Cubox', country: 'us', name: 'Cubox' },
    { term: 'Readwise Reader', country: 'us', name: 'Readwise Reader' },
    { term: 'Raindrop.io', country: 'us', name: 'Raindrop' },
    { term: 'mymind', country: 'us', name: 'mymind' },
    { term: 'Instapaper', country: 'us', name: 'Instapaper' },
  ]

  for (const target of targets) {
    const app = await findAppId(target.term, target.country)
    if (!app) {
      console.log(`跳过 ${target.name}（${target.country}）：没找到 app`)
      continue
    }
    const rows = await fetchReviews(app.id, target.country, target.name)
    console.log(`${target.name}(${target.country}) id=${app.id} 评论 ${rows.length} 条`)
    reviews.push(...rows)
  }

  const issues = []
  for (const repo of ['karakeep-app/karakeep', 'linkwarden/linkwarden', 'omnivore-app/omnivore']) {
    try {
      const result = await fetchIssues(repo)
      issues.push(result)
      console.log(`${repo} open issue ${result.issues.length} 条`)
    } catch (error) {
      console.log(`${repo} 取不到：${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  const lowRated = reviews.filter((row) => row.rating <= 3)
  await writeFile('/tmp/competitor-voice.json', JSON.stringify({ reviews, issues }, null, 2), 'utf8')
  console.log(`\n共 ${reviews.length} 条评论，其中 3 星及以下 ${lowRated.length} 条；已写入 /tmp/competitor-voice.json`)
}

await main()
