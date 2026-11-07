import { useEffect, useState } from 'react'
import { AppState, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useColorScheme } from 'react-native'

import '../global.css'

import { installCrashLogger } from '../src/local/crash-log'
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

// 尽早装：模块加载期间抛的错也要留下来。
installCrashLogger()

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  )
}

/** StatusBar 与系统底色都要跟着明暗走，所以单独一层。 */
function AppShell() {
  const p = usePalette()
  const scheme = useColorScheme()

  // Android 根视图默认白底，跟随主题换掉，避免切换/启动时闪一下。
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

  // 打开本地库后继续处理上次没整理完的收藏；回到前台时再扫一遍。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // 先装回语言与外观，再渲染第一屏：否则会先闪一下系统默认，再跳过去。
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
