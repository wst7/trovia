import { fetchArticle } from './article'
import { buildVectors } from './embed'
import { emitChange } from './bus'
import { summarizeWithLlm } from './llm'
import { isOcrAvailable, ocrImages } from './ocr'
import * as repo from './repo'
import { oneLine } from './util'

/**
 * 本机处理队列：抓取 → 解析 → 摘要 → 落库。
 *
 * 没有服务端 worker，所以单飞、串行处理；一次最多处理 20 条，
 * 剩下的等下次保存、回到前台或手动刷新时继续。
 */
let running = false

export function isProcessing(): boolean {
  return running
}

export async function processPendingQueue(): Promise<void> {
  if (running) return
  running = true
  try {
    for (let i = 0; i < 20; i += 1) {
      const next = await repo.nextPending()
      if (!next) break
      try {
        await processOne(next.id, next.url)
      } catch {
        // 单条出错不能卡住整个队列；状态留在非终态会在下次启动时被重置。
        await repo.markFailed(next.id, 'INTERNAL_ERROR').catch(() => undefined)
        emitChange()
      }
    }
  } finally {
    running = false
    emitChange()
    // 语义索引在解析之后慢慢补，失败不打扰用户，下次再试。
    void buildVectors(6).catch(() => undefined)
  }
}

async function processOne(id: string, url: string): Promise<void> {
  await repo.setStatus(id, 'fetching', 'fetch')
  emitChange()

  let article
  try {
    article = await fetchArticle(url)
  } catch (error) {
    // 403/401/412/451 是站点主动拒绝，不是网络抖动：两者的补救方式完全不同。
    const message = error instanceof Error ? error.message : ''
    const refused = /HTTP (401|403|412|451)/.test(message)
    await repo.markFailed(id, refused ? 'FETCH_BLOCKED' : 'FETCH_FAILED')
    emitChange()
    return
  }

  await repo.setStatus(id, 'parsing', 'parse')

  // 网页没给标题时，沿用分享文字/剪贴板里带过来的标题，别把用户已经看到的信息丢掉。
  if (!article.title) article.title = await repo.getSeededTitle(id)

  // 页面里只要有图，就把图里的字读出来——长文里的截屏、思维导图同样是内容，
  // 搜索时不该因为「正文已经够长」而漏掉它们。
  if (isOcrAvailable() && article.images.length > 0) {
    await repo.setStatus(id, 'analyzing', 'summarize')
    emitChange()
    const texts = await ocrImages(article.images, url)
    if (texts.length > 0) {
      const recognized = texts.join('\n\n')
      article.markdown = [article.markdown, '## 图片文字', recognized]
        .filter((part) => part && part.trim())
        .join('\n\n')
      article.plainText = [article.plainText, recognized]
        .filter((part) => part && part.trim())
        .join('\n\n')
    }
  }

  // 和原来的后端语义一致：正文太短只算部分成功，元信息照常保留。
  if (article.plainText.length < 120) {
    await repo.savePartial(id, article)
    emitChange()
    return
  }

  await repo.setStatus(id, 'analyzing', 'summarize')
  emitChange()

  const title = article.title ?? url
  let summary = ''
  let keywords: string[] = []

  const llm = await summarizeWithLlm({ title, url, text: article.plainText })
  if (llm) {
    summary = llm.summary
    keywords = llm.keywords
  }
  if (!summary) {
    // 抽取式兜底：只用原文里的描述或开头，不生成原文没有的内容。
    summary = article.description ?? oneLine(article.plainText, 220)
  }

  await repo.saveParsed(id, article, summary, oneLine(summary, 160), keywords)
  emitChange()
}
