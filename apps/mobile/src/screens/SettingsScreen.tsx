import { appVersion } from '../local/app-version'
import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps, ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
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
import {
  applyOta,
  checkOta,
  checkOtaAvailability,
  readOtaPending,
  readOtaState,
  writeOtaPending,
  writeOtaPendingVersion,
} from '../local/ota'
import { checkForUpdate, type CheckResult } from '../local/update'
import { resolveUpdateAction, resolveUpdateView } from '../local/update-state'
import { downloadApk, formatMb, installApk, type DownloadProgress } from '../local/update-install'
import { listAllForExportFidelity } from '../local/repo'
import { loadLlmState } from '../local/llm'
import * as repo from '../local/repo'
import type { DocumentStats } from '../local/repo'
import { isDevMode, opLog, setDevMode } from '../local/dev-log'
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

/** A settings group: white background, 14dp corners, 1px border, an inset hairline between rows. */
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
 * Classic settings row: icon + title + optional subtitle + value on the right + chevron.
 * Only a row with onPress is tappable; read-only info rows get no chevron — a chevron is the promise that you can go in.
 */
function Row({
  icon,
  title,
  subtitle,
  value,
  valueIcon,
  onPress,
  danger = false,
  busy = false,
  selected,
  accessibilityLabel,
}: {
  icon?: IconName
  title: string
  subtitle?: string
  value?: string
  /** Small icon before the value: a new version shows a small arrow instead of an extra line of copy. */
  valueIcon?: IconName
  onPress?: () => void
  danger?: boolean
  /** Work that requires waiting is running: the right-side icon slot becomes a spinner. */
  busy?: boolean
  /**
   * One-of-several row. Shows the radio on the right and drops the chevron:
   * a chevron promises "this leads somewhere", which is the opposite of
   * "picking this applies it here". Passing an icon as well is allowed
   * (some settings want both a glyph and a choice).
   */
  selected?: boolean
  accessibilityLabel?: string
}) {
  const p = usePalette()
  const body = (
    <View className="min-h-[52px] flex-row items-center gap-3 px-4">
      {/* Rows without a glyph keep the same left edge: the icon slot is a fixed
          18px column, and the gap after it is part of the layout too. */}
      {icon ? (
        <Ionicons name={icon} size={18} color={danger ? p.danger : p.muted} />
      ) : (
        <View style={{ width: 18 }} />
      )}
      <View className="flex-1">
        <Text className={danger ? 'text-body-sm text-danger' : 'text-body-sm text-ink'}>
          {title}
        </Text>
        {subtitle ? <Text className="mt-0.5 text-caption text-muted">{subtitle}</Text> : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={p.muted} /> : null}
      {!busy && valueIcon ? <Ionicons name={valueIcon} size={13} color={p.muted} /> : null}
      {value ? (
        <Text className="max-w-[52%] text-caption text-muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {selected !== undefined ? (
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={18}
          color={selected ? p.accent : p.faint}
        />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={15} color={p.faint} />
      ) : null}
    </View>
  )

  if (!onPress) return body
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={selected !== undefined ? 'radio' : 'button'}
      accessibilityState={selected !== undefined ? { checked: selected } : undefined}
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
  const [version, setVersion] = useState<string | null>(null)
  // The version row is the update entry point itself: no separate page, and no split into "full package / hot update" downloads.
  // Two channels, two states. `native` is the installed package (only a new APK
  // changes it); `ota` is JavaScript delivered without touching the version.
  const [native, setNative] = useState<CheckResult | null>(null)
  const [otaAvailable, setOtaAvailable] = useState(false)
  const [otaPending, setOtaPending] = useState(false)
  // Which JavaScript is on screen: embedded in the package, or a downloaded update.
  const [runningOta, setRunningOta] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'checking' | 'downloading' | 'installing' | 'error'>('idle')
  const [devOn, setDevOn] = useState(false)
  const [sync, setSync] = useState<{ configured: boolean; at: string | null } | null>(null)
  const [localePref, setLocalePref] = useState<LocalePreference>('system')
  const [themePref, setThemePref] = useState<ThemePreference>('system')
  // Re-fetch the whole library: an interruptible batch whose progress goes in the row subtitle.
  const [rebulk, setRebulk] = useState<{ done: number; total: number; current: string | null } | null>(null)
  const stopRebulk = useRef(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)

  const view = resolveUpdateView({
    phase,
    otaPending,
    otaAvailable,
    nativeUpdate:
      native?.hasUpdate && native.latest
        ? { version: native.latest.version, sizeBytes: native.latest.asset?.size ?? 0 }
        : null,
    progress,
  })

  /** One sentence for the row, derived from the state table in update-state.ts. */
  const updateSubtitle = (): string => {
    switch (view.kind) {
      case 'checking':
        return t('update.state.checking')
      case 'downloading':
        // Zero bytes for ten seconds reads as stuck: say what is actually happening.
        if (view.written === 0) return t('update.state.connecting')
        return view.ratio >= 0
          ? t('update.state.downloading', { percent: Math.round(view.ratio * 100) })
          : t('update.state.downloading.noSize')
      case 'installing':
        return t('update.state.installing')
      case 'error':
        return t('update.state.retry')
      case 'restart':
        return t('update.state.restart')
      case 'ota':
        return t('update.state.otaAvailable')
      case 'native':
        return t('update.state.available', { version: view.version, size: formatMb(view.sizeBytes) })
      case 'latest':
        return native?.error ? t('update.state.unknown') : t('update.state.latest')
    }
  }

  /** Look at both channels. Cheap: the OTA check downloads nothing. */
  const refreshUpdate = async (manual: boolean) => {
    if (phase === 'checking' || phase === 'downloading' || phase === 'installing') return
    setPhase('checking')
    try {
      const [nativeVersion, ota, state, pending] = await Promise.all([
        version ?? appVersion(),
        checkOtaAvailability(),
        readOtaState().catch(() => null),
        readOtaPending(),
      ])
      const result = await checkForUpdate(nativeVersion, manual)
      setNative(result)
      setOtaAvailable(ota.available)
      setOtaPending(pending)
      setRunningOta(Boolean(state?.enabled && state.runningUpdate))
      if (manual && !ota.available && !result.hasUpdate && !result.error) {
        toast(t('update.state.latest'))
      }
    } catch {
      setNative((current) => current ?? null)
    } finally {
      setPhase('idle')
    }
  }

  /** Download the JavaScript update; it applies on the next launch. */
  const downloadOta = async () => {
    setPhase('downloading')
    setProgress({ ratio: 0, written: 0, total: 0 })
    try {
      const outcome = await checkOta()
      await opLog('update.ota', { kind: outcome.kind })
      if (outcome.kind === 'downloaded') {
        // Downloaded is not applied: the row keeps offering the restart until the
        // app actually starts on it (see the mount path in reload()).
        await writeOtaPendingVersion(native?.latest?.version)
        await writeOtaPending(true)
        setOtaPending(true)
        setOtaAvailable(false)
        setPhase('idle')
        return
      }
      // Nothing on the channel after all: fall back to a fresh look.
      setPhase('idle')
      void refreshUpdate(false)
    } catch (error) {
      await opLog('update.ota', { kind: 'failed' }, error)
      setPhase('error')
    } finally {
      setProgress(null)
    }
  }

  /** Download the package and hand it to the system installer. */
  const downloadNative = async () => {
    if (!native?.latest?.asset) return
    const targetVersion = native.latest.version
    const size = native.latest.asset.size
    const startedAt = Date.now()
    setPhase('downloading')
    setProgress({ ratio: 0, written: 0, total: size })
    await opLog('update.download.start', { version: targetVersion, size })
    try {
      const name = native.latest.asset.name || `trovia-${targetVersion}.apk`
      const file = await downloadApk(native.latest.asset.url, name, (next) => setProgress(next))
      await opLog('update.download.done', { version: targetVersion, ms: Date.now() - startedAt })
      setPhase('installing')
      await opLog('update.install', { version: targetVersion })
      await installApk(file)
      setPhase('idle')
    } catch (error) {
      await opLog('update.fail', { version: targetVersion, stage: 'download' }, error)
      setPhase('error')
    } finally {
      setProgress(null)
    }
  }

  /** The version row's only tap target. */
  const onTapUpdate = () => {
    const action = resolveUpdateAction(view)
    if (action === 'check') void refreshUpdate(true)
    else if (action === 'download-ota') void downloadOta()
    else if (action === 'download-apk') void downloadNative()
    else if (action === 'restart') {
      void (async () => {
        try {
          await opLog('update.restart')
          await applyOta()
        } catch {
          setPhase('error')
        }
      })()
    }
  }


  const handleReprocessAll = () => {
    void opLog('rebulk.toggle', { running: Boolean(rebulk) })
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
    setDevOn(isDevMode())
    void appVersion().then(async (next) => {
      setVersion(next)
      // A downloaded bundle stops being "pending" the moment the app runs it.
      const state = await readOtaState().catch(() => null)
      setRunningOta(Boolean(state?.enabled && state.runningUpdate))
      const pending = await readOtaPending()
      if (state?.runningUpdate && pending) {
        await writeOtaPending(false)
        await writeOtaPendingVersion(null)
      }
      setOtaPending(state?.runningUpdate ? false : pending)
      void refreshUpdate(false)
    })
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
      // If reading the local library fails, keep the previous value and don't interrupt the user.
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void reload()
      void getThemePreference().then(setThemePref)
    }, [reload, revision]),
  )

  async function handleExport() {
    void opLog('export.start', { documents: stats?.total ?? 0 })
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
    // The most destructive action in the app: it should always leave a line.
    await opLog('clearAll.start')
    try {
      await clearAllDocuments()
      emitChange()
      await reload()
      await opLog('clearAll.done')
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
                    : t('llm.state.off')
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
                selected={themePref === option.value}
                title={t(option.labelKey)}
                onPress={() => {
                  void opLog('pref.theme', { value: option.value })
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
                selected={localePref === option.value}
                title={t(option.labelKey)}
                onPress={() => {
                  void opLog('pref.locale', { value: option.value })
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
              subtitle={updateSubtitle()}
              value={`v${version ?? '—'}${runningOta ? t('settings.about.hotAppend') : ''}`}
              valueIcon={view.kind === 'latest' ? undefined : 'arrow-up-circle'}
              busy={view.kind === 'checking'}
              onPress={onTapUpdate}
            />
            <Row
              icon="code-slash-outline"
              title={t('settings.dev.title')}
              subtitle={t('settings.dev.subtitle')}
              onPress={() => {
                void (async () => {
                  const next = !devOn
                  await setDevMode(next)
                  setDevOn(next)
                  toast(next ? t('dev.on') : t('dev.off'))
                })()
              }}
              value={devOn ? t('settings.dev.on') : t('settings.dev.off')}
            />
            {devOn ? (
              <Row
                icon="list-outline"
                title={t('settings.dev.logTitle')}
                subtitle={t('settings.dev.logSubtitle')}
                onPress={() => router.push('/diagnostics')}
              />
            ) : null}
          </Group>
        </View>
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
