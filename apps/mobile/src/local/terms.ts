/** Narrative filler phrases, stripped before matching, so "I remember that article…" does not pollute the keywords. */
const FILLER = /(我记得|记得|好像|大概|可能是|应该是|之前|以前|看过|看到过|收藏过|收藏了|帮我找|找一下|找找|那篇|这篇|一篇|一个|那个|这个|关于|讲的|说的|也就是|内容|文章|视频|链接)/g

/**
 * High-frequency function words / generic words: they appear in almost every article, so matching them equals not matching at all,
 * they only flood the "literal results" and also block the semantic fallback. Chinese bigram matching needs this table especially.
 */
const STOP_TERMS = new Set([
  '怎么', '什么', '如何', '为什', '么会', '可以', '需要', '自己', '我们', '他们', '你们',
  '这个', '那个', '一个', '一些', '这些', '那些', '就是', '还是', '但是', '因为', '所以',
  '如果', '已经', '现在', '时候', '时间', '问题', '东西', '事情', '觉得', '认为', '没有',
  '不是', '真的', '非常', '比较', '一直', '这样', '那样', '很多', '如何', '这些', '关于',
  '的时', '时候', '有的', '时候', '一种', '是否', '以及', '或者', '然后', '而且', '并且',
  '这种', '那种', '种东', '个东', '么东', '这玩', '玩意', '有点', '一点', '好像', '感觉',
])

/**
 * Whether a sentence actually contains a content word at all.
 *
 * Decides whether the semantic fallback should run: Chinese bigrams let a sentence like "…that kind of thing" be split into words too,
 * so a completely meaningless query also gets five "similar meaning" results — which damages trust more than saying "not found".
 * Fragments of function words (e.g. a bigram that is only a slice of a longer filler phrase) are filtered out here too.
 */
export function hasContentTerm(query: string): boolean {
  const cleaned = query
    .toLowerCase()
    .replace(FILLER, ' ')
    .replace(/[，。！？、,.!?;；:：\"'“”‘’（）()[\]【】《》<>…]/g, ' ')

  // English/numeric words: length >= 2 counts as a content word (redis, go, trait). Gibberish is left to the semantic score threshold.
  for (const word of cleaned.match(/[a-z0-9][a-z0-9.+#_-]*/g) ?? []) {
    if (word.length >= 2) return true
  }

  // Chinese segments: strip the function words one by one, and only two or more characters left counts as a content word.
  // "There is no such thing" strips to an empty string, while "delay queue" loses not a single character.
  const stopWords = [...STOP_TERMS].sort((a, b) => b.length - a.length)
  for (const run of cleaned.match(/[一-鿿]+/g) ?? []) {
    let rest = run
    for (const word of stopWords) rest = rest.split(word).join('')
    if (rest.length >= 2) return true
  }
  return false
}

export function queryTerms(query: string): string[] {
  const cleaned = query
    .toLowerCase()
    .replace(FILLER, ' ')
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()[\]【】《》<>]/g, ' ')
  const terms = new Set<string>()

  for (const word of cleaned.match(/[a-z0-9][a-z0-9.+#_-]*/g) ?? []) {
    if (word.length >= 2) terms.add(word)
  }
  for (const run of cleaned.match(/[一-鿿]+/g) ?? []) {
    if (run.length <= 2) {
      terms.add(run)
    } else {
      // Chinese has no word segmentation: bigrams buy recall, and long words are additionally kept whole to improve precision.
      for (let i = 0; i < run.length - 1; i += 1) terms.add(run.slice(i, i + 2))
      if (run.length <= 6) terms.add(run)
    }
  }
  // Remove generic words and single characters: single characters (possessive particles, aspect particles, the copula) hit almost inevitably in Chinese and only create noise.
  return [...terms].filter((term) => !STOP_TERMS.has(term) && term.length >= 2).slice(0, 24)
}
