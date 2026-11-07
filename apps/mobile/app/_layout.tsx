import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { Text } from '../src/ui/text'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useColorScheme } from 'react-native'

import '../global.css'

import { installCrashLogger } from '../src/local/crash-log'
import { loadDevMode } from '../src/local/dev-log'
import { maybeAutoSync } from '../src/local/auto-sync'
import { maybeRetryFailed } from '../src/local/auto-retry'
import { hydrateImages } from '../src/local/image-hydrate'
import { ClipboardPrompt } from '../src/components/ClipboardPrompt'
import { getDb } from '../src/local/db'
import { loadLocalePreference } from '../src/i18n/prefs'
import { loadThemePreference } from '../src/theme'
import { processPendingQueue } from '../src/local/pipeline'
import { ToastProvider } from '../src/providers/ToastProvider'
import { ShareIntentBridge } from '../src/share/ShareIntentBridge'
import { usePalette } from '../src/ui/palette'

// Installed as early as possible: even errors thrown while modules load must be captured.
installCrashLogger()
void loadDevMode()

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  )
}

/** Both the StatusBar and the system background must follow light/dark, so this gets its own layer. */
function AppShell() {
  const p = usePalette()
  const scheme = useColorScheme()

  // The Android root view is white by default; swap it to follow the theme so switching or launching does not flash white.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(p.canvas).catch(() => undefined)
  }, [p.canvas])

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ToastProvider>
        <RootNavigator />
      </ToastProvider>
    </>
  )
}

function RootNavigator() {
  const [ready, setReady] = useState(false)
  const p = usePalette()

  // Once the local DB is open, keep processing the saves left unprocessed last time; scan again when the app returns to the foreground.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // Restore locale and appearance before rendering the first screen: otherwise the system default flashes first and then jumps to the real one.
        await Promise.all([loadLocalePreference(), loadThemePreference()])
        await getDb()
      } finally {
        if (!cancelled) setReady(true)
      }
      void processPendingQueue()
      void hydrateImages()
      void maybeAutoSync()
      void maybeRetryFailed()
    })()

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      void processPendingQueue()
      void maybeAutoSync()
      void maybeRetryFailed()
    })
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  return (
    <View className="flex-1 bg-canvas">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: p.canvas },
          animation: 'fade',
        }}
      />
      <ShareIntentBridge />
      <ClipboardPrompt enabled={ready} />
      {!ready && (
        <View className="absolute inset-0 items-center justify-center gap-2 bg-canvas">
          <Text className="text-title font-semibold text-ink">Trovia</Text>
          <Text className="text-caption text-muted">Save anything. Find it by memory.</Text>
        </View>
      )}
    </View>
  )
}
