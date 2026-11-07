/** Tiny class joiner: drops only false/null/undefined and keeps the order. */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}
