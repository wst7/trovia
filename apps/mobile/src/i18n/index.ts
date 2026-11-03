/**
 * 界面文案的唯一出口。
 *
 * 中文写在 zh 字典里，英文写在 en 字典里，两份的键必须一一对应（有单测守着）。
 * 组件不拼字符串，只喊键名；带变量的地方用 {name} 占位。
 *
 * 语言优先级：用户在设置里选的 > 系统语言 > 中文。
 * 系统语言靠 Intl 读，不额外装 expo-localization。
 */
import { useSyncExternalStore } from 'react'

import { en } from './en'
import { zh } from './zh'

export type Locale = 'zh' | 'en'
/** 用户的选择：跟随系统，或锁定某一种。 */
export type LocalePreference = Locale | 'system'

export type Dictionary = Record<string, string>

const DICTIONARIES: Record<Locale, Dictionary> = { zh, en }

let preference: LocalePreference = 'system'
let resolved: Locale = 'zh'
const listeners = new Set<() => void>()

/** 读系统语言：zh 开头就是中文，其余一律英文。 */
export function detectSystemLocale(): Locale {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale ?? ''
    return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'zh'
  }
}

function resolve(pref: LocalePreference): Locale {
  return pref === 'system' ? detectSystemLocale() : pref
}

export function getLocalePreference(): LocalePreference {
  return preference
}

export function getLocale(): Locale {
  return resolved
}

export function applyLocalePreference(pref: LocalePreference): void {
  preference = pref
  resolved = resolve(pref)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 组件里用这个取当前语言，切换语言时会重渲染。 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

/**
 * 取一条文案。缺失时退回中文，再缺就返回键名本身——
 * 界面上出现「home.title」这种字样，比空一片更容易被发现。
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const value = DICTIONARIES[locale][key] ?? DICTIONARIES.zh[key] ?? key
  if (!vars) return value
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

/** 组件外用：当前语言的 t。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(resolved, key, vars)
}

/** 组件内用：跟着语言变化重渲染。 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  useLocale()
  return t
}

export { zh, en }
