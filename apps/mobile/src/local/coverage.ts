/**
 * The “relevance threshold” for search results.
 *
 * Chinese has no word segmentation, so a query gets split into character bigrams (a query of N characters also yields the overlapping bigrams plus the whole string),
 * which is good for recall but bad because any stray sentence can graze a common bigram (a phrase like “… that sort of thing” hits the bigram “that sort”),
 * and so the screen shows twenty confidently wrong results — which does more damage to trust than “nothing found”.
 *
 * Rule: at least half of the query's terms have to match. For a whole-phrase hit (for example “delayed queue redis”), because
 * the bigrams are almost all present, coverage is naturally very high; a sentence that only grazed one or two generic terms gets blocked.
 */
export function requiredCoverage(termCount: number): number {
  if (termCount <= 0) return 0
  return Math.max(1, Math.ceil(termCount / 2))
}

export function passesCoverage(matchedTerms: number, termCount: number): boolean {
  if (termCount <= 0) return true
  return matchedTerms >= requiredCoverage(termCount)
}
