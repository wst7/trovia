/**
 * 图片里认出来的字往哪儿放。
 *
 * 只进检索用的纯文本，不进正文 markdown：那些字是搜索的线索，不是文章内容。
 * 把 OCR 结果并进正文，读者会在文末看到一大段「## 图片文字」，跟这篇文章的
 * 正文混在一起，读起来像乱码。
 */
export function mergeOcrText(
  article: { markdown: string; plainText: string },
  recognized: string,
): { markdown: string; plainText: string } {
  const text = recognized.trim()
  if (!text) return article
  return {
    markdown: article.markdown,
    plainText: [article.plainText, text].filter((part) => part && part.trim()).join('\n\n'),
  }
}
