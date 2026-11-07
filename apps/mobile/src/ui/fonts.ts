/**
 * Body font: Source Han Serif (a subset).
 *
 * Android has no Chinese serif in the system, so if it should read like a paper book we have to ship one ourselves.
 * The font is a subset of 7542 common characters (the full GB2312 table + ASCII + CJK and Latin punctuation),
 * weighing 2.3MB; rare characters fall back to the system font, slightly different in style but never missing.
 *
 * useSyncExternalStore provides an "is it loaded yet" subscription, so the body re-renders once the font
 * is in place instead of staying stuck on the system font forever.
 */
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'

/**
 * The font name comes from what the expo-font plugin registers, based on the file name.
 * The font is baked into the native binary (the expo-font plugin in app.config) and is no longer downloaded at runtime —
 * a runtime loadAsync fails when there is no embedded asset table (ExpoAsset.downloadAsync).
 */
export const SERIF_FAMILY = 'NotoSerifSC-Regular'

/**
 * UI font: named explicitly, so it does not inherit vendor skins.
 * On iOS, System is already PingFang, so no extra family name is needed.
 */
export const SANS_FAMILY = Platform.OS === 'android' ? 'sans-serif' : undefined


/**
 * One switch to flip the body/title font, for easy comparison:
 *   true  = serif (the Source Han Serif subset)
 *   false = the system sans-serif
 * Once it is settled, delete this switch and keep only the chosen face.
 */
export const SERIF_ENABLED = true

// Registered natively and available at any time; the subscription is kept for a future switch to a variable font that needs loading.
let ready = true
const listeners = new Set<() => void>()

export function isSerifReady(): boolean {
  return ready
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether the font is available yet; finishing the load triggers one re-render. */
export function useSerifReady(): boolean {
  const loaded = useSyncExternalStore(subscribe, isSerifReady, isSerifReady)
  return SERIF_ENABLED && loaded
}

/**
 * The whole app uses a single typeface: Source Han Serif.
 *
 * It used to be "sans for the UI + serif for reading", and the two shapes were obvious from screen to screen, so lists and articles
 * looked like two apps. Now, apart from monospace (logs), all text uses this one family;
 * SANS_FAMILY is kept only for the edge cases that have to follow the system.
 */
export const APP_FAMILY = SERIF_ENABLED ? SERIF_FAMILY : SANS_FAMILY
