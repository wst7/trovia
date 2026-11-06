/**
 * 输入框下方那行提示，什么时候出现、说什么。
 *
 * 规则只有一条：**只有「模式」和「动作」不一致时说话**。
 * 开关开着（问 AI）却贴了条链接——这时用户会疑惑，所以提示一句。
 * 其余时候保持安静：搜索态贴链接存下来本来就是常态，再解释就是废话。
 */
export function composerHint(
  args: { ask: boolean; saveMode: boolean; error: string | null },
  labels: { aiLink: string },
): string {
  if (args.error) return args.error
  if (args.ask && args.saveMode) return labels.aiLink
  return ''
}
