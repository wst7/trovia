import { fetchArticle } from './article'
import { opLog } from './dev-log'
import { buildVectors } from './embed'
import { cacheImages } from './imageStore'
import { emitChange } from './bus'
import { summarizeWithLlm } from './llm'
import { isOcrAvailable, ocrImages } from './ocr'
import { mergeOcrText } from './ocr-text'
import * as repo from './repo'
import { oneLine } from './util'

/**
 * On-device processing queue: fetch → parse → summarize → store.
 *
 * There is no server worker, so it runs single-flight and serially; at most 20 items per pass,
 * and the rest continue on the next save, on returning to the foreground, or on a manual refresh.
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
        // One bad item must not stall the whole queue; a status left non-terminal is reset on the next launch.
        await repo.markFailed(next.id, 'INTERNAL_ERROR').catch(() => undefined)
        emitChange()
      }
    }
  } finally {
    running = false
    emitChange()
    // The semantic index is filled in gradually after parsing; failures don't bother the user and are retried next time.
    void buildVectors(6).catch(() => undefined)
  }
}

/**
 * Download the body images to local storage. Failure doesn't affect the text: positions not saved locally are left empty
 * and the detail screen falls back to the remote URL.
 */
async function storeImages(id: string, images: string[], referer: string): Promise<void> {
  if (images.length === 0) return
  try {
    const files = await cacheImages(id, images, referer)
    if (files.some((file) => file.length > 0)) await repo.setImageFiles(id, files)
  } catch {
    // Images are an enhancement; failing to store them must not fail the parse
  }
}

async function processOne(id: string, url: string): Promise<void> {
  const startedAt = Date.now()
  await repo.setStatus(id, 'fetching', 'fetch')
  emitChange()
  await opLog('parse.fetch.start', { id, url })

  let article
  try {
    article = await fetchArticle(url)
    await opLog('parse.fetch.ok', {
      id,
      ms: Date.now() - startedAt,
      chars: article.plainText.length,
      images: article.images.length,
    })
  } catch (error) {
    // 403/401/412/451 are the site refusing on purpose, not network flakiness: the two need completely different remedies.
    const message = error instanceof Error ? error.message : ''
    const refused = /HTTP (401|403|412|451)/.test(message)
    await repo.markFailed(id, refused ? 'FETCH_BLOCKED' : 'FETCH_FAILED')
    await opLog('parse.fetch.fail', { id, url, refused, ms: Date.now() - startedAt }, error)
    emitChange()
    return
  }

  await repo.setStatus(id, 'parsing', 'parse')

  // When the page gives no title, keep the one carried in from the share text/clipboard rather than dropping what the user already saw.
  if (!article.title) article.title = await repo.getSeededTitle(id)

  // If the page has images, read the text inside them — screenshots and mind maps in a long article are content too,
  // and search shouldn't miss them just because "the body is already long enough".
  if (isOcrAvailable() && article.images.length > 0) {
    await repo.setStatus(id, 'analyzing', 'summarize')
    emitChange()
    const texts = await ocrImages(article.images, url)
    if (texts.length > 0) {
      // Text recognized from images goes only into the search text (plainText), never into the body markdown:
      // it is a search clue, not article content, and putting it in the body only makes the reader hit a block of "image text".
      const merged = mergeOcrText(article, texts.join('\n\n'))
      article.markdown = merged.markdown
      article.plainText = merged.plainText
    }
  }

  // Same semantics as the old backend: too little body counts as partial success, and metadata is kept as usual.
  if (article.plainText.length < 120) {
    await opLog('parse.partial', { id, chars: article.plainText.length, ms: Date.now() - startedAt })
    await repo.savePartial(id, article)
    await storeImages(id, article.images, url)
    emitChange()
    return
  }

  await repo.setStatus(id, 'analyzing', 'summarize')
  emitChange()

  const title = article.title ?? url
  let summary = ''
  let keywords: string[] = []

  const llm = await summarizeWithLlm({ title, url, text: article.plainText })
  await opLog('parse.summary', { id, by: llm ? 'model' : 'extract' })
  if (llm) {
    summary = llm.summary
    keywords = llm.keywords
  }
  if (!summary) {
    // Extractive fallback: use only the description or the opening of the original; never generate content that isn't there.
    summary = article.description ?? oneLine(article.plainText, 220)
  }

  await repo.saveParsed(id, article, summary, oneLine(summary, 160), keywords)
  await storeImages(id, article.images, url)
  await opLog('parse.done', {
    id,
    ms: Date.now() - startedAt,
    chars: article.plainText.length,
    images: article.images.length,
  })
  emitChange()
}
