/**
 * 搜索结果的「相关性门槛」。
 *
 * 中文没有分词，查询会拆成二元组（「延时队列」→ 延时/时队/队列/延时队列），
 * 好处是召回高，坏处是随便一句话也能蹭上一个常见二元组（「…这种东西」命中「这种」），
 * 于是屏幕上是二十条自信满满的错误结果——比「没找到」更伤信任。
 *
 * 规则：至少要对上查询的一半词。整词命中的查询（延时队列 redis）因为二元组几乎都在，
 * 覆盖率天然很高；而只蹭到一两个泛词的句子会被挡掉。
 */
export function requiredCoverage(termCount: number): number {
  if (termCount <= 0) return 0
  return Math.max(1, Math.ceil(termCount / 2))
}

export function passesCoverage(matchedTerms: number, termCount: number): boolean {
  if (termCount <= 0) return true
  return matchedTerms >= requiredCoverage(termCount)
}
