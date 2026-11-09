/**
 * Small UI preferences that should survive a restart.
 *
 * Separate from llm/sync settings on purpose: these are about how the screen
 * behaves, not about the library, and they must never be a reason for a screen
 * to fail to open — every read falls back to a default.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const ASK_MODE_KEY = 'ui.askMode'

/** Whether the composer opens in AI mode. */
export async function loadAskMode(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ASK_MODE_KEY)) === '1'
  } catch {
    return false
  }
}

export async function saveAskMode(on: boolean): Promise<void> {
  await AsyncStorage.setItem(ASK_MODE_KEY, on ? '1' : '0').catch(() => undefined)
}
