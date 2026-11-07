/**
 * Appearance: follow the system, or lock to light / dark.
 *
 * No need to maintain a theme state of our own — leave it to the system Appearance: NativeWind's dark: variants and
 * the color variables in global.css all hang off this value. Once locked, the system switching to another mode does not change it,
 * which is exactly what the user means by choosing "dark".
 */
import { Appearance, useColorScheme } from 'react-native'

import { readSetting, writeSetting } from '../local/settings'

export type ThemePreference = 'system' | 'light' | 'dark'
export type Scheme = 'light' | 'dark'

const KEY = 'ui.theme'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** Called once at startup to put the previous choice back onto the system appearance. */
export async function loadThemePreference(): Promise<ThemePreference> {
  let pref: ThemePreference = 'system'
  try {
    const stored = await readSetting(KEY)
    if (isPreference(stored)) pref = stored
  } catch {
    pref = 'system'
  }
  // Apply only, do not write to the database: a cold start should not produce a pointless write.
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
    // Failing to store it does not affect this run; the next startup falls back to following the system.
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

/** The actual current light/dark, used by components to pick colors (palette goes through it too). */
export function useScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light'
}
