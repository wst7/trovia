/** 叙述性的口头语，匹配前先去掉，避免「我记得那篇……」污染关键词。 */
const FILLER = /(我记得|记得|好像|大概|可能是|应该是|之前|以前|看过|看到过|收藏过|收藏了|帮我找|找一下|找找|那篇|这篇|一篇|一个|那个|这个|关于|讲的|说的|也就是|内容|文章|视频|链接)/g

/**
 * 高频虚词/泛词：它们在几乎每篇文章里都出现，命中它们等于没命中，
 * 只会把「字面结果」灌满，还挡住语义兜底。中文二元组匹配尤其需要这张表。
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
 * 一句话里到底有没有实词。
 *
 * 判定语义回退要不要跑：中文二元组让「…这种东西」这种句子也能拆出词，
 * 于是完全没有意义的查询也会拿到五条「意思相近」的结果——比说「没找到」更伤信任。
 * 虚词碎片（如「种东」是「这种东西」的子串）也在这里滤掉。
 */
export function hasContentTerm(query: string): boolean {
  const cleaned = query
    .toLowerCase()
    .replace(FILLER, ' ')
    .replace(/[，。！？、,.!?;；:：\"'“”‘’（）()[\]【】《》<>…]/g, ' ')

  // 英文/数字词：长度 >= 2 就算实词（redis、go、trait）。乱码交给语义分数线。
  for (const word of cleaned.match(/[a-z0-9][a-z0-9.+#_-]*/g) ?? []) {
    if (word.length >= 2) return true
  }

  // 中文段：把虚词一个个剥掉，剥完还剩两个字以上才算有实词。
  // 「没有这种东西」剥完是空串，而「延时队列」一个字都不会被剥掉。
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
      // 中文没有分词：用二元组换取召回，长词额外保留整词以提高精度。
      for (let i = 0; i < run.length - 1; i += 1) terms.add(run.slice(i, i + 2))
      if (run.length <= 6) terms.add(run)
    }
  }
  // 去掉泛词与单字：单字（的/了/是）在中文里几乎必然命中，只会制造噪声。
  return [...terms].filter((term) => !STOP_TERMS.has(term) && term.length >= 2).slice(0, 24)
}
