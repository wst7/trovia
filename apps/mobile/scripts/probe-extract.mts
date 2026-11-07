/**
 * Extraction probe: runs extractFromHtml against links from real platforms and prints the output length and any failure reason.
 *
 * Usage: npx tsx scripts/probe-extract.mts
 * Note: this is not a unit test but an acceptance script over real links and real HTML; when it finishes it prints a table.
 */
import { extractFromHtml } from '../src/local/article.ts'

const APP_UA = 'Mozilla/5.0 (compatible; Xunji/0.1; local-first)'
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

const TARGETS: { label: string; url: string }[] = [
  { label: '微信', url: 'https://mp.weixin.qq.com/s/9L7FBQg60PmiotLEV91BPg' },
  { label: '知乎专栏', url: 'https://zhuanlan.zhihu.com/p/461717274' },
  { label: '掘金', url: 'https://juejin.cn/post/7143946519886954527' },
  { label: 'CSDN', url: 'https://blog.csdn.net/vviccc/article/details/110313339' },
  { label: '少数派', url: 'https://sspai.com/post/117960' },
  { label: '简书', url: 'https://www.jianshu.com/p/fe72aaa1d657' },
  { label: '豆瓣日记', url: 'https://m.douban.com/note/873992220/' },
  { label: '36氪', url: 'https://36kr.com/p/1723893334017' },
  { label: 'V2EX', url: 'https://www.v2ex.com/t/1253511' },
  { label: 'Medium', url: 'https://medium.com/write-a-catalyst/how-to-write-an-article-in-5-easy-steps-66bf6dcd0eac' },
  { label: 'GitHub', url: 'https://github.com/facebook/react' },
  { label: '维基', url: 'https://zh.wikipedia.org/wiki/%E7%9D%A1%E7%9C%A0' },
  { label: 'B站视频', url: 'https://www.bilibili.com/video/BV1GJ411x7h7' },
  { label: 'GitHub PR', url: 'https://github.com/react/react/pull/38088' },
  { label: 'X 帖子', url: 'https://x.com/jack/status/20' },
  { label: 'Reddit', url: 'https://old.reddit.com/r/programming/' },
  { label: '阮一峰', url: 'https://www.ruanyifeng.com/blog/2024/01/weekly-issue-287.html' },
]

interface Row {
  label: string
  url: string
  status: number
  bytes: number
  title: string
  chars: number
  images: number
  flags: string
}

async function probe(target: { label: string; url: string }, ua: string): Promise<Row> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch(target.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })
    const html = (await res.text()).slice(0, 3 * 1024 * 1024)
    const out = extractFromHtml(html, target.url)
    const flags = [out.blocked && 'blocked', out.appOnly && 'appOnly', out.scriptOnly && 'scriptOnly']
      .filter(Boolean)
      .join(',')
    return {
      label: target.label,
      url: target.url,
      status: res.status,
      bytes: html.length,
      title: (out.title ?? '').slice(0, 24),
      chars: (out.plainText ?? '').length,
      images: (out.images ?? []).length,
      flags: flags || '-',
    }
  } catch (e) {
    return {
      label: target.label,
      url: target.url,
      status: 0,
      bytes: 0,
      title: '',
      chars: 0,
      images: 0,
      flags: e instanceof Error ? e.message.slice(0, 30) : 'error',
    }
  } finally {
    clearTimeout(timer)
  }
}

function print(rows: Row[], tag: string) {
  console.log(`\n### ${tag}`)
  console.log(['平台', 'HTTP', 'HTML', '标题', '字数', '图', '标记'].join('\t'))
  for (const r of rows) {
    console.log([r.label, r.status, r.bytes, r.title, r.chars, r.images, r.flags].join('\t'))
  }
  const ok = rows.filter((r) => r.chars >= 300).length
  console.log(`可用（≥300 字）：${ok}/${rows.length}`)
}

const mode = process.argv[2] ?? 'both'
const jobs = TARGETS.map((t) => probe(t, process.env.UA_MODE === 'app' ? APP_UA : BROWSER_UA))
const rows = await Promise.all(jobs)
print(rows, process.env.UA_MODE === 'app' ? 'App UA' : 'Browser UA')
