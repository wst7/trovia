/**
 * The hint line under the composer: when it appears and what it says.
 *
 * There is only one rule: **speak only when the mode and the action disagree**.
 * The switch is on (ask the AI) yet a link was pasted — that is confusing, so say one line.
 * Stay quiet the rest of the time: pasting a link in search mode to save it is normal, and explaining it further is noise.
 */
export function composerHint(
  args: { ask: boolean; saveMode: boolean; error: string | null },
  labels: { aiLink: string },
): string {
  if (args.error) return args.error
  if (args.ask && args.saveMode) return labels.aiLink
  return ''
}
