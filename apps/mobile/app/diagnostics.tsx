import { useCallback, useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../src/ui/text'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { clearCrashLog, readCrashLog } from '../src/local/crash-log'
import { clearDevLog, diagnosticsSnapshot, isDevMode, readDevLog, setDevMode } from '../src/local/dev-log'
import { useT } from '../src/i18n'
import { Button, IconButton } from '../src/ui/Button'
import { Screen } from '../src/ui/Screen'

/**
 * Diagnostics screen: crash records + dev log + environment snapshot, shared as a txt with one tap.
 *
 * There are two entry points — the red line on the home screen (only shown once something has gone wrong), and a long press on the home title to enter developer mode.
 * Not put in settings: the settings screen itself may be the page that crashed.
 */
export default function DiagnosticsScreen() {
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [crash, setCrash] = useState<string | null>(null)
  const [dev, setDev] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState('')
  const [devOn, setDevOn] = useState(false)

  const reload = useCallback(async () => {
    const [crashLog, devLogText, snap] = await Promise.all([
      readCrashLog(),
      readDevLog(),
      diagnosticsSnapshot(),
    ])
    setCrash(crashLog)
    // Newest at the top: when something breaks the user just performed that action, so it should be the first thing they see.
    setDev(
      devLogText === null
        ? null
        : devLogText
            .split('\n')
            .filter((line) => line.trim())
            .reverse()
            .join('\n'),
    )
    setSnapshot(snap)
    setDevOn(isDevMode())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const share = async () => {
    try {
      const body = [
        t('diagnostics.title'),
        '',
        '--- environment ---',
        snapshot,
        '',
        '--- crash log ---',
        crash ?? '(none)',
        '',
        '--- dev log ---',
        dev ?? '(none)',
        '',
      ].join('\n')
      const FS = await import('expo-file-system/legacy')
      const path = `${FS.documentDirectory}diagnostics.txt`
      await FS.writeAsStringAsync(path, body)
      const Sharing = await import('expo-sharing')
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: t('diagnostics.share') })
      }
    } catch {
      // If sharing fails, let the user read the screen out to us.
    }
  }

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-4" style={{ paddingTop: insets.top + 8 }}>
        <IconButton name="chevron-back" onPress={() => router.back()} accessibilityLabel={t('detail.back')} />
        <Text onPress={() => void share()} className="text-body text-accent">
          {t('diagnostics.share')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Text className="text-title font-semibold text-ink">{t('diagnostics.title')}</Text>
        <Text className="mt-2 text-body-sm text-muted">{t('diagnostics.hint')}</Text>

        <Text className="mt-6 text-caption text-muted">{t('diagnostics.env')}</Text>
        <View className="mt-2 rounded-md border border-line p-3">
          <Text className="text-mono leading-5 text-ink">
            {snapshot || '—'}
          </Text>
        </View>

        <Text className="mt-6 text-caption text-muted">{t('diagnostics.crash')}</Text>
        <View className="mt-2 rounded-md border border-line p-3">
          <Text className="text-caption leading-5 text-muted">
            {crash ?? t('diagnostics.empty')}
          </Text>
        </View>

        <Text className="mt-6 text-caption text-muted">{t('diagnostics.ops')}</Text>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-caption text-muted">{devOn ? t('dev.onTitle') : t('dev.offTitle')}</Text>
          <Text
            className="text-caption text-accent"
            onPress={() => {
              void (async () => {
                await setDevMode(!devOn)
                await reload()
              })()
            }}
          >
            {devOn ? t('dev.turnOff') : t('dev.turnOn')}
          </Text>
        </View>
        <View className="mt-2 rounded-md border border-line p-3">
          <Text className="text-mono leading-5 text-muted">
            {dev ?? t('diagnostics.empty')}
          </Text>
        </View>

        <View className="mt-6 flex-row items-center gap-3">
          <Button label={t('diagnostics.share')} onPress={() => void share()} size="sm" />
          <Button
            label={t('diagnostics.clear')}
            onPress={() => {
              void (async () => {
                // Clear both together: when the user taps "clear logs", they mean "stop keeping these around".
                await Promise.all([clearCrashLog(), clearDevLog()])
                await reload()
              })()
            }}
            size="sm"
            variant="quiet"
          />
        </View>
      </ScrollView>
    </Screen>
  )
}
