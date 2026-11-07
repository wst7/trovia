import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { readCrashLog } from '../src/local/crash-log'
import { useT } from '../src/i18n'
import { Button } from '../src/ui/Button'
import { Screen } from '../src/ui/Screen'

/** 崩溃记录页：给用户一条「出事了，把这段发给我」的路，不藏在设置里。 */
export default function DiagnosticsScreen() {
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [log, setLog] = useState<string | null>(null)

  useEffect(() => {
    void readCrashLog().then(setLog)
  }, [])

  return (
    <Screen>
      <View className="flex-row items-center px-4 pt-3" style={{ paddingTop: insets.top + 8 }}>
        <Text onPress={() => router.back()} className="text-body text-muted">
          {t('detail.back')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Text className="text-title font-semibold text-ink">{t('diagnostics.title')}</Text>
        <Text className="mt-2 text-body-sm text-muted">{t('diagnostics.hint')}</Text>
        <View className="mt-5 rounded-md border border-line p-3">
          <Text className="text-caption leading-5 text-muted" style={{ fontFamily: 'monospace' }}>
            {log ?? t('diagnostics.empty')}
          </Text>
        </View>
        <View className="mt-6 self-start">
          <Button label={t('diagnostics.back')} onPress={() => router.replace('/')} size="sm" />
        </View>
      </ScrollView>
    </Screen>
  )
}
