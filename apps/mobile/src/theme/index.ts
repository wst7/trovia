/**
 * 外观：跟随系统，或锁定浅色 / 深色。
 *
 * 不用自己维护一套主题状态——交给系统的 Appearance：NativeWind 的 dark: 变体、
 * global.css 里的颜色变量都挂在这个值上。锁定之后系统切到别的模式也不跟着变，
 * 这就是用户选「深色」时的意思。
 */
import { Appearance, useColorScheme } from 'react-native'

import { readSetting, writeSetting } from '../local/settings'

export type ThemePreference = 'system' | 'light' | 'dark'
export type Scheme = 'light' | 'dark'

const KEY = 'ui.theme'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** 启动时调一次，把上次的选择装回系统外观上。 */
export async function loadThemePreference(): Promise<ThemePreference> {
  let pref: ThemePreference = 'system'
  try {
    const stored = await readSetting(KEY)
    if (isPreference(stored)) pref = stored
  } catch {
    pref = 'system'
  }
  // 只应用，不写库：冷启动不该产生一次无意义的写入。
  applyTheme(pref)
  return pref
}

export function applyTheme(pref: ThemePreference): void {
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref)
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  applyTheme(pref)
  try {
    await writeSetting(KEY, pref)
  } catch {
    // 存不进去也不影响这次，下次启动回到跟随系统。
  }
}

export async function getThemePreference(): Promise<ThemePreference> {
  try {
    const stored = await readSetting(KEY)
    return isPreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** 当前实际的明暗，组件用它取色（palette 也走这条）。 */
export function useScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light'
}
