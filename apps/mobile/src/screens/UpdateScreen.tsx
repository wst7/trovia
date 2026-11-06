/**
 * 「检查更新」这一屏：当前版本、最新版本、更新说明、下载与安装。
 *
 * 没有后端，所以这里只有一个来源：GitHub 的 latest Release。
 * 检查失败不吓人——离线时用户照样能用整个 App，页面只说明为什么没查到。
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import Constants from 'expo-constants'

import { useT } from '../i18n'
import { checkForUpdate } from '../local/update'
import type { CheckResult } from '../local/update'
import { downloadApk, formatMb, installApk } from '../local/update-install'
import type { DownloadProgress } from '../local/update-install'
import { useToast } from '../providers/ToastProvider'
import { GUTTER, Screen } from '../ui/Screen'
import { Divider } from '../ui/Divider'
import { usePalette } from '../ui/palette'

type Phase = 'idle' | 'checking' | 'downloading' | 'installing'

export function UpdateScreen() {
  const t = useT()
  const router = useRouter()
  const { toast } = useToast()
  const p = usePalette()
  const current = Constants.expoConfig?.version ?? '0.0.0'

  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  // 失败原因留在页面上：toast 一闪就没了，用户回头看不到为什么没装上。
  const [failure, setFailure] = useState<string | null>(null)

  const check = useCallback(
    async (force: boolean) => {
      setPhase('checking')
      try {
        const outcome = await checkForUpdate(current, force)
        setResult(outcome)
      } finally {
        setPhase('idle')
      }
    },
    [current],
  )

  useEffect(() => {
    void check(false)
  }, [check])

  async function handleInstall() {
    const asset = result?.latest?.asset
    if (!asset) return
    setPhase('downloading')
    setProgress(null)
    setFailure(null)
    try {
      const uri = await downloadApk(asset.url, asset.name, setProgress)
      setPhase('installing')
      await installApk(uri)
      toast(t('update.toast.prompt'), { type: 'success' })
    } catch (error) {
      const reason = error instanceof Error ? error.message : t('update.toast.failed')
      setFailure(reason)
      toast(reason, { type: 'error' })
    } finally {
      setPhase('idle')
      setProgress(null)
    }
  }

  const latest = result?.latest ?? null
  const busy = phase !== 'idle'
  const ratio = progress?.ratio ?? -1

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-[22px] pt-2">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text className="text-body text-muted">{t('detail.back')}</Text>
        </Pressable>
        <Text className="text-caption tracking-[0.14em] text-faint">{t('update.title').toUpperCase()}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48 }}>
        <View className="mt-6 flex-row items-baseline justify-between">
          <Text className="text-body text-muted">{t('update.current')}</Text>
          <Text className="text-[24px] font-semibold text-ink">v{current}</Text>
        </View>
        <Divider className="mt-4" />

        {phase === 'checking' ? (
          <View className="mt-6 flex-row items-center gap-2">
            <ActivityIndicator size="small" color={p.accent} />
            <Text className="text-body-sm text-muted">{t('update.checking')}</Text>
          </View>
        ) : null}

        {!busy && result?.error ? (
          <View className="mt-6">
            <Text className="text-body text-ink">{t('update.failed')}</Text>
            <Text className="mt-2 text-body-sm text-muted">{result.error}</Text>
            <Pressable onPress={() => void check(true)} hitSlop={8} className="mt-5">
              <Text className="text-body text-accent">{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : null}

        {!busy && result && !result.error && !result.hasUpdate ? (
          <View className="mt-6">
            <Text className="text-body text-ink">{t('update.latest')}</Text>
            <Pressable onPress={() => void check(true)} hitSlop={8} className="mt-5">
              <Text className="text-body text-accent">{t('update.checkAgain')}</Text>
            </Pressable>
          </View>
        ) : null}

        {latest && result?.hasUpdate ? (
          <View className="mt-6">
            <Text className="text-body text-muted">{t('update.available')}</Text>
            <View className="mt-1 flex-row items-baseline gap-2">
              <Text className="text-[26px] font-semibold text-ink">v{latest.version}</Text>
              {latest.asset?.size ? (
                <Text className="text-caption text-faint">{formatMb(latest.asset.size)}</Text>
              ) : null}
            </View>

            {latest.notes ? (
              <View className="mt-5">
                <Text className="text-caption tracking-[0.14em] text-faint">{t('update.notes')}</Text>
                <Text className="mt-2 text-body-sm leading-6 text-muted" numberOfLines={12}>
                  {latest.notes}
                </Text>
              </View>
            ) : null}

            {failure ? (
              <Text className="mt-4 text-body-sm leading-6 text-danger">{failure}</Text>
            ) : null}

            {phase === 'downloading' ? (
              <View className="mt-6">
                <Text className="text-body-sm text-muted">
                  {ratio >= 0
                    ? t('update.downloading', { percent: Math.round(ratio * 100) })
                    : t('update.downloadingUnknown', { size: formatMb(progress?.written ?? 0) })}
                </Text>
                <View className="mt-3 h-[2px] w-full bg-line">
                  <View
                    className="h-[2px] bg-accent"
                    style={{ width: ratio >= 0 ? `${Math.min(100, Math.max(0, ratio * 100))}%` : '30%' }}
                  />
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => void handleInstall()}
                disabled={busy || !latest.asset}
                className={busy || !latest.asset ? 'mt-7 bg-sunken px-4 py-3' : 'mt-7 bg-ink px-4 py-3'}
              >
                <Text className={busy || !latest.asset ? 'text-body text-faint' : 'text-body text-canvas'}>
                  {phase === 'installing' ? t('update.installing') : t('update.install')}
                </Text>
              </Pressable>
            )}

            <Text className="mt-4 text-caption leading-5 text-faint">{t('update.hint')}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}
