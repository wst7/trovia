/**
 * 语言选择的存取。默认「跟随系统」，用户改过就记住。
 */
import { readSetting, writeSetting } from '../local/settings'
import type { LocalePreference } from './index'
import { applyLocalePreference, getLocalePreference } from './index'

const KEY = 'ui.locale'

function isPreference(value: unknown): value is LocalePreference {
  return value === 'system' || value === 'zh' || value === 'en'
}

/** 启动时调一次，把用户上次的选择装回去。 */
export async function loadLocalePreference(): Promise<LocalePreference> {
  try {
    const stored = await readSetting(KEY)
    const pref: LocalePreference = isPreference(stored) ? stored : 'system'
    applyLocalePreference(pref)
    return pref
  } catch {
    applyLocalePreference('system')
    return 'system'
  }
}

export async function setLocalePreference(pref: LocalePreference): Promise<void> {
  applyLocalePreference(pref)
  try {
    await writeSetting(KEY, pref)
  } catch {
    // 存不进去也不影响这一次会话，下次启动会回到跟随系统。
  }
}

export { getLocalePreference }
