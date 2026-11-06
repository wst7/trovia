import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps, ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TAB_BAR_HEIGHT } from '../components/AppTabBar'
import { countReprocessTargets, reprocessAll } from '../local/rebulk'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Divider } from '../ui/Divider'
import { Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'
import { emitChange } from '../local/bus'
import { isSyncConfigured } from '../local/auto-sync'
import { clearAllDocuments } from '../local/db'
import { relativeTime } from '../local/dates'
import { lastSyncAt } from '../local/sync-config'
import { formatBytes, writeExport } from '../local/exporter'
import { listAllForExportFidelity } from '../local/repo'
import { loadLlmState } from '../local/llm'
import * as repo from '../local/repo'
import type { DocumentStats } from '../local/repo'
import { useLocalRevision } from '../local/useLocalRevision'
import { useToast } from '../providers/ToastProvider'
import { useT } from '../i18n'
import { setLocalePreference } from '../i18n/prefs'
import { getThemePreference, setThemePreference } from '../theme'
import type { ThemePreference } from '../theme'
import type { LocalePreference } from '../i18n'

const APP_NAME = 'Trovia'

const THEME_OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.theme.system' },
  { value: 'light', labelKey: 'settings.theme.light' },
  { value: 'dark', labelKey: 'settings.theme.dark' },
]

const LOCALE_OPTIONS: { value: LocalePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.language.system' },
  { value: 'zh', labelKey: 'settings.language.zh' },
  { value: 'en', labelKey: 'settings.language.en' },
]

type IconName = ComponentProps<typeof Ionicons>['name']

function statsLine(stats: DocumentStats | null, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (stats === null) return t('settings.stats.loading')
  if (stats.total === 0) return t('settings.stats.empty')
  const parts = [t('settings.stats.total', { count: stats.total })]
  if (stats.processing > 0) parts.push(t('settings.stats.processing', { count: stats.processing }))
  if (stats.failed > 0) parts.push(t('settings.stats.failed', { count: stats.failed }))
  return parts.join(' · ')
}

/** 一组设置项：白底、14dp 圆角、1px 描边，行间一条内缩发丝线。 */
function Group({ children }: { children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children]
  return (
    <View className="overflow-hidden rounded-md border border-line bg-surface">
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? (
            <View className="pl-12">
              <Divider />
            </View>
          ) : null}
          {child}
        </View>
      ))}
    </View>
  )
}

/**
 * 经典设置行：图标 + 标题 +（可选）副标题 + 右侧值 + 箭头。
 * 有 onPress 才是可点的行，只读信息行不给箭头——箭头是「这里能进去」的承诺。
 */
function Row({
  icon,
  title,
  subtitle,
  value,
  onPress,
  danger = false,
  accessibilityLabel,
}: {
  icon: IconName
  title: string
  subtitle?: string
  value?: string
  onPress?: () => void
  danger?: boolean
  accessibilityLabel?: string
}) {
  const p = usePalette()
  const body = (
    <View className="min-h-[52px] flex-row items-center gap-3 px-4">
      <Ionicons name={icon} size={18} color={danger ? p.danger : p.muted} />
      <View className="flex-1">
        <Text className={danger ? 'text-body-sm text-danger' : 'text-body-sm text-ink'}>
          {title}
        </Text>
        {subtitle ? <Text className="mt-0.5 text-caption text-muted">{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text className="max-w-[52%] text-caption text-muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={15} color={p.faint} /> : null}
    </View>
  )

  if (!onPress) return body
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {({ pressed }) => <View style={{ opacity: pressed ? 0.55 : 1 }}>{body}</View>}
    </Pressable>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2 ml-1 text-[11px] font-semibold tracking-[1px] text-faint">{children}</Text>
  )
}

export function SettingsScreen() {
  const t = useT()
  const router = useRouter()
  const { toast } = useToast()
  const revision = useLocalRevision()
  const insets = useSafeAreaInsets()

  const [stats, setStats] = useState<DocumentStats | null>(null)
  const [llm, setLlm] = useState<{ enabled: boolean; model: string | null } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [sync, setSync] = useState<{ configured: boolean; at: string | null } | null>(null)
  const [localePref, setLocalePref] = useState<LocalePreference>('system')
  const [themePref, setThemePref] = useState<ThemePreference>('system')
  // 整库重抓：可中断的批处理，进度写在行副标题上。
  const [rebulk, setRebulk] = useState<{ done: number; total: number; current: string | null } | null>(null)
  const stopRebulk = useRef(false)

  const handleReprocessAll = () => {
    if (rebulk) {
      stopRebulk.current = true
      return
    }
    stopRebulk.current = false
    void (async () => {
      const total = await countReprocessTargets()
      setRebulk({ done: 0, total, current: null })
      const result = await reprocessAll(
        (progress) => setRebulk(progress),
        () => stopRebulk.current,
      )
      setRebulk(null)
      toast(
        result.stopped
          ? t('settings.rebulk.stopped', { count: result.processed })
          : t('settings.rebulk.done', { count: result.processed }),
        { type: 'success' },
      )
    })()
  }

  const [confirmingClear, setConfirmingClear] = useState(false)

  const bottomPad = insets.bottom + TAB_BAR_HEIGHT + 24

  const reload = useCallback(async () => {
    try {
      const [nextStats, llm, configured, syncedAt] = await Promise.all([
        repo.documentStats(),
        loadLlmState(),
        isSyncConfigured(),
        lastSyncAt(),
      ])
      setStats(nextStats)
      setLlm({ enabled: llm.enabled, model: llm.model ?? null })
      setSync({ configured, at: syncedAt ?? null })
    } catch {
      // 读本地库失败时保持上一次的值，不打断用户。
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void reload()
      void getThemePreference().then(setThemePref)
    }, [reload, revision]),
  )

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const docs = await listAllForExportFidelity()
      if (docs.length === 0) {
        toast(t('settings.export.empty'), { type: 'warning' })
        return
      }
      const result = await writeExport(docs)
      if (!result) {
        toast(t('settings.export.noWrite'), { type: 'error' })
        return
      }
      const Sharing = await import('expo-sharing')
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.path, { mimeType: 'application/zip', dialogTitle: t('settings.export.dialog') })
      }
      toast(
        t('settings.export.done', {
          count: docs.length,
          size: formatBytes(result.zipBytes),
          raw: formatBytes(result.rawBytes),
        }),
        { type: 'success' },
      )
    } catch {
      toast(t('settings.export.failed'), { type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  async function handleClear() {
    try {
      await clearAllDocuments()
      emitChange()
      await reload()
      toast(t('settings.clear.done'), { type: 'success' })
    } catch {
      toast(t('settings.clear.failed'), { type: 'error' })
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
      >
        <View className="h-14 justify-center">
          <Text className="text-heading font-semibold text-ink">{t('settings.title')}</Text>
        </View>
        <Text className="mb-6 text-caption text-faint">{t('settings.subtitle')}</Text>

        <View className="mb-6">
          <SectionLabel>{t('settings.section.sync')}</SectionLabel>
          <Group>
            <Row
              icon="cloud-outline"
              title={t('settings.sync.title')}
              subtitle={t('settings.sync.subtitle')}
              value={
                sync === null
                  ? ''
                  : !sync.configured
                    ? t('settings.sync.none')
                    : sync.at
                      ? t('settings.sync.at', { when: relativeTime(sync.at) })
                      : t('settings.sync.waiting')
              }
              onPress={() => router.push('/settings/sync')}
              accessibilityLabel={t('settings.sync.title')}
            />
            <Row
              icon="phone-portrait-outline"
              title={t('settings.storage.title')}
              subtitle={t('settings.storage.subtitle')}
              value={statsLine(stats, t)}
            />
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>{t('settings.section.organize')}</SectionLabel>
          <Group>
            <Row
              icon="sparkles-outline"
              title={t('settings.llm.title')}
              subtitle={t('settings.llm.subtitle')}
              value={
                llm === null
                  ? ''
                  : llm.enabled
                    ? t('settings.llm.on', { model: llm.model || t('settings.llm.unnamed') })
                    : t('settings.llm.off')
              }
              onPress={() => router.push('/settings/llm')}
              accessibilityLabel={t('settings.llm.a11y')}
            />
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>{t('settings.section.data')}</SectionLabel>
          <Group>
            <Row
              icon="enter-outline"
              title={t('settings.import.title')}
              subtitle={t('settings.import.subtitle')}
              onPress={() => router.push('/settings/import')}
              accessibilityLabel={t('settings.import.title')}
            />
            <Row
              icon="download-outline"
              title={t('settings.export.title')}
              subtitle={
                exporting ? t('settings.export.writing') : t('settings.export.subtitle')
              }
              value={stats ? t('settings.stats.total', { count: stats.total }) : undefined}
              onPress={() => void handleExport()}
              accessibilityLabel={t('settings.export.title')}
            />
            <Row
              icon="refresh-outline"
              title={rebulk ? t('settings.rebulk.stop') : t('settings.rebulk.title')}
              subtitle={
                rebulk
                  ? `${t('settings.rebulk.progress', { done: rebulk.done, total: rebulk.total })}${
                      rebulk.current ? ` · ${rebulk.current.slice(0, 18)}` : ''
                    }`
                  : t('settings.rebulk.subtitle')
              }
              value={rebulk ? t('settings.rebulk.running') : undefined}
              onPress={handleReprocessAll}
              accessibilityLabel={rebulk ? t('settings.rebulk.stop') : t('settings.rebulk.title')}
            />
            <Row
              icon="trash-outline"
              title={t('settings.clear.title')}
              subtitle={t('settings.clear.subtitle')}
              danger
              onPress={() => setConfirmingClear(true)}
              accessibilityLabel={t('settings.clear.title')}
            />
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>{t('settings.section.appearance')}</SectionLabel>
          <Group>
            {THEME_OPTIONS.map((option) => (
              <Row
                key={option.value}
                icon={themePref === option.value ? 'radio-button-on' : 'radio-button-off'}
                title={t(option.labelKey)}
                onPress={() => {
                  setThemePref(option.value)
                  void setThemePreference(option.value)
                }}
                accessibilityLabel={t(option.labelKey)}
              />
            ))}
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>{t('settings.section.language')}</SectionLabel>
          <Group>
            {LOCALE_OPTIONS.map((option) => (
              <Row
                key={option.value}
                icon={localePref === option.value ? 'radio-button-on' : 'radio-button-off'}
                title={t(option.labelKey)}
                onPress={() => {
                  setLocalePref(option.value)
                  void setLocalePreference(option.value)
                }}
                accessibilityLabel={t(option.labelKey)}
              />
            ))}
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>{t('settings.section.about')}</SectionLabel>
          <Group>
            <Row
              icon="information-circle-outline"
              title={APP_NAME}
              subtitle={t('settings.about.local')}
              value={`v${Constants.expoConfig?.version ?? '—'}`}
            />
            <Row
              icon="cloud-download-outline"
              title={t('update.title')}
              subtitle={t('update.rowHint')}
              onPress={() => router.push('/settings/update')}
            />
          </Group>
        </View>

        <Text className="mt-2 text-center text-caption text-faint">
          {t('settings.footer')}
        </Text>
      </ScrollView>
      <ConfirmDialog
        visible={confirmingClear}
        title={t('settings.clear.confirmTitle')}
        message={t('settings.clear.confirmBody')}
        confirmLabel={t('settings.clear.confirmAction')}
        destructive
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false)
          void handleClear()
        }}
      />
    </Screen>
  )
}
