/** 拼 class 的小工具：只丢掉 false/null/undefined，保留顺序。 */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}
