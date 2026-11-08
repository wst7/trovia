/**
 * Where the characters recognised in images go.
 *
 * Search only. They answer "I remember the figure on that screenshot", but they
 * are not the article's prose: putting them in the body or in plain_text made
 * them show up in the reader (and in the summary written from that text), which
 * is why they are appended to the search string alone.
 */
export function appendOcrForSearch(searchText: string, recognized: string | undefined): string {
  const text = (recognized ?? '').trim()
  if (!text) return searchText
  return [searchText.trim(), text].filter(Boolean).join('\n')
}
