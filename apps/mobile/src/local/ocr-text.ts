/**
 * Where the characters recognized in images go.
 *
 * They go only into the plain text used for search, not into the body markdown: those characters are search clues, not article content.
 * Merging the OCR results into the body would leave the reader seeing a long "## Image text" block at the end, mixed in with this article's
 * own body text, which reads like gibberish.
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
