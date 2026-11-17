/**
 * One input box, three destinations: save a link, search by words, or ask the model.
 *
 * The box used to carry a mode switch, which asked the user to answer "which
 * mode am I in" before typing. Classifying the input instead costs one guess,
 * and a wrong guess is fixed by one tap on the result screen.
 */
export type ComposerIntent = 'save' | 'ask' | 'search'

/** Chinese question markers: a trailing question mark or particle, or a common interrogative. */
const ASK_ZH =
  /[?？]\s*$|[吗呢吧]\s*$|为什么|怎么|怎样|如何|哪个|哪些|哪篇|有没有|是不是|能不能|可不可以|区别|对比|差在哪|凭什么|值不值/

/** English questions start with an auxiliary or interrogative, or compare two things. */
const ASK_EN =
  /^\s*(?:how|why|what|which|who|whose|when|where|is|are|was|were|do|does|did|can|could|should|would|have|has)\b|\b(?:compare|difference|differences|versus|vs)\b/i

/**
 * Classify one submission.
 *
 * Only a question goes to the model: local search costs nothing and answers
 * immediately, while a model round trip needs the network and time. Erring
 * toward search keeps the common case fast.
 */
export function detectIntent(text: string, hasUrl: boolean): ComposerIntent {
  if (hasUrl) return 'save'
  const trimmed = text.trim()
  if (trimmed.length < 4) return 'search'
  return ASK_ZH.test(trimmed) || ASK_EN.test(trimmed) ? 'ask' : 'search'
}
