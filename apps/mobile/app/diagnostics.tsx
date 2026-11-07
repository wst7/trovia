import { useCallback, useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../src/ui/text'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { clearCrashLog, readCrashLog } from '../src/local/crash-log'
import { clearDevLog, diagnosticsSnapshot, isDevMode, readDevLog, setDevMode } from '../src/local/dev-log'
import { useT } from '../src/i18n'
import { Button } from '../src/ui/Button'
import { Screen } from '../src/ui/Screen'

/**
 * 诊断页：崩溃记录 + 开发日志 + 环境快照，一键分享成 txt。
 *
 * 入口有两个——首页那行红字（出过问题才出现），以及长按首页标题进开发者模式。
 * 不放设置里：设置页本身可能就是崩掉的那一页。
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
    setDev(devLogText)
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
      // 分享失败就让用户照着屏幕念给我们听。
    }
  }

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-4" style={{ paddingTop: insets.top + 8 }}>
        <Text onPress={() => router.back()} className="text-body text-muted">
          {t('detail.back')}
        </Text>
        <Text onPress={() => void share()} className="text-body text-accent">
          {t('diagnostics.share')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Text className="text-title font-semibold text-ink">{t('diagnostics.title')}</Text>
        <Text className="mt-2 text-body-sm text-muted">{t('diagnostics.hint')}</Text>

        <Text className="mt-6 text-caption text-muted">{t('diagnostics.env')}</Text>
        <View className="mt-2 rounded-md border border-line p-3">
          <Text className="text-caption leading-5 text-ink" style={{ fontFamily: 'monospace' }}>
            {snapshot || '—'}
          </Text>
        </View>

        <Text className="mt-6 text-caption text-muted">{t('diagnostics.crash')}</Text>
        <View className="mt-2 rounded-md border border-line p-3">
          <Text className="text-caption leading-5 text-muted" style={{ fontFamily: 'monospace' }}>
            {crash ?? t('diagnostics.empty')}
          </Text>
        </View>

        <View className="mt-6 flex-row items-center justify-between">
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
          <Text className="text-caption leading-5 text-muted" style={{ fontFamily: 'monospace' }}>
            {dev ?? t('diagnostics.empty')}
          </Text>
        </View>

        <View className="mt-6 flex-row items-center gap-3">
          <Button label={t('diagnostics.share')} onPress={() => void share()} size="sm" />
          <Button
            label={t('diagnostics.clear')}
            onPress={() => {
              void (async () => {
                // 两份一起清：用户点「清空日志」的意思是「这些别再留着了」。
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
