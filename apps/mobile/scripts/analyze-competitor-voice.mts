/**
 * Bucket the collected reviews by "pain point".
 *
 * No fancy NLP: a few fixed keyword groups are enough to see the direction, and the result is reproducible —
 * anyone can run the same JSON and get the same counts.
 */
import { readFile } from 'node:fs/promises'

interface Review {
  source: string
  app: string
  rating: number
  title: string
  text: string
  at: string
}

interface Issue {
  number: number
  title: string
  comments: number
  reactions: { total_count: number }
  labels: { name: string }[]
  html_url: string
}

const THEMES: { key: string; label: string; pattern: RegExp }[] = [
  { key: 'sync', label: '同步/多端不同步', pattern: /(同步|sync|多端|设备之间|另一台|不同步|跨设备)/i },
  { key: 'lost', label: '数据丢失/内容消失', pattern: /(丢失|不见了|消失了|没了|删除|丢数据|disappear|lost|missing)/i },
  { key: 'price', label: '价格/订阅', pattern: /(订阅|收费|价格|涨价|付费|会员|price|subscription|expensive|refund)/i },
  { key: 'search', label: '搜不到/检索差', pattern: /(搜不到|搜索|查找|检索|search|find|找不到)/i },
  { key: 'ai', label: 'AI 不准/胡编', pattern: /(AI|ai|总结|摘要|summary|hallucinat|不准|胡说|瞎编|garbage)/i },
  { key: 'export', label: '导出/被锁定', pattern: /(导出|export|备份|backup|锁定|lock-in|csv|markdown)/i },
  { key: 'cn', label: '中文/国内站点支持', pattern: /(中文|微信|公众号|国内|知乎|小红书|Chinese|wechat)/i },
  { key: 'perf', label: '卡顿/崩溃/慢', pattern: /(卡顿|崩溃|闪退|很慢|太慢|crash|slow|lag|freeze|bug)/i },
  { key: 'login', label: '登录/账号问题', pattern: /(登录|注册|账号|account|login|sign in|password)/i },
  { key: 'ui', label: '界面/易用性', pattern: /(界面|ui|ux|难用|复杂|confusing|clunky|design|字体)/i },
  { key: 'offline', label: '离线/网络依赖', pattern: /(离线|offline|断网|网络|no internet)/i },
]

async function main() {
  const raw = await readFile('/tmp/competitor-voice.json', 'utf8')
  const data = JSON.parse(raw) as { reviews: Review[]; issues: { repo: string; issues: Issue[] }[] }
  const low = data.reviews.filter((row) => row.rating <= 3)

  console.log(`样本：${data.reviews.length} 条评论，其中 1-3 星 ${low.length} 条\n`)

  const buckets = THEMES.map((theme) => ({
    ...theme,
    hits: low.filter((row) => theme.pattern.test(`${row.title} ${row.text}`)),
  })).sort((a, b) => b.hits.length - a.hits.length)

  console.log('痛点分布（按 1-3 星评论命中数）：')
  for (const bucket of buckets.slice(0, 8)) {
    const byApp = new Map<string, number>()
    for (const hit of bucket.hits) byApp.set(hit.app, (byApp.get(hit.app) ?? 0) + 1)
    const spread = [...byApp.entries()].sort((a, b) => b[1] - a[1]).map(([app, n]) => `${app} ${n}`).join('、')
    console.log(`  ${bucket.label.padEnd(12)} ${String(bucket.hits.length).padStart(3)} 条   ${spread}`)
  }

  console.log('\n每个痛点最典型的原话：')
  for (const bucket of buckets.slice(0, 6)) {
    const sample = bucket.hits.slice(0, 2)
    for (const row of sample) {
      const text = `${row.title} — ${row.text}`.replace(/\s+/g, ' ').slice(0, 120)
      console.log(`  [${bucket.label}] ${row.app} (${row.rating}★) ${text}`)
    }
  }

  console.log('\nGitHub 上讨论最多的 issue：')
  for (const group of data.issues) {
    const top = [...group.issues].sort((a, b) => b.comments - a.comments).slice(0, 4)
    console.log(`\n  ${group.repo}`)
    for (const issue of top) {
      console.log(`    #${issue.number} (${issue.comments} 评论) ${issue.title.slice(0, 70)}`)
    }
  }
}

await main()
