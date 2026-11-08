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
  readOtaPending,
  readOtaPendingVersion,
  readOtaState,
  readOtaTakenVersion,
  recordOtaTakenVersion,
  writeOtaPending,
  writeOtaPendingVersion,
} from '../local/ota'
import { checkForUpdate, effectiveVersion, type CheckResult } from '../local/update'
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
  const [update, setUpdate] = useState<CheckResult | null>(null)
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'checking' | 'downloading' | 'installing' | 'error'>('idle')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  // The hot update is downloaded but not yet restarted into: this state stays on screen until the user taps.
  // Kept in storage too: this screen remounts when the user switches tabs, and a
  // restart hint that disappears on remount leaves a download button that does nothing.
  const [otaReady, setOtaReady] = useState(false)
  // True when the JS on screen came from a hot update rather than the installed
  // package: that is the case where the UI can look older than the version number.
  const [runningOta, setRunningOta] = useState(false)
  // A manual check came back "already latest": the subtitle has to say so, otherwise tapping looks like nothing happened.
  const [checkedJustNow, setCheckedJustNow] = useState(false)
  // Developer mode: off by default; "view log" only appears on this page while it is on.
  const [devOn, setDevOn] = useState(false)
  const [sync, setSync] = useState<{ configured: boolean; at: string | null } | null>(null)
  const [localePref, setLocalePref] = useState<LocalePreference>('system')

  const [themePref, setThemePref] = useState<ThemePreference>('system')
  // Re-fetch the whole library: an interruptible batch whose progress goes in the row subtitle.
  const [rebulk, setRebulk] = useState<{ done: number; total: number; current: string | null } | null>(null)
  const stopRebulk = useRef(false)

  /** The version row's subtitle is the update status, said in one sentence. */
  const updateSubtitle = (): string => {
    if (otaReady) return t('update.state.restart')
    if (updatePhase === 'checking') return t('update.state.checking')
    if (updatePhase === 'downloading') {
      // A download sitting at zero for ten seconds reads as stuck; say what is
      // actually happening until the first byte lands.
      if (!progress || progress.written === 0) return t('update.state.connecting')
      const percent = progress.ratio >= 0 ? Math.round(progress.ratio * 100) : null
      return percent === null ? t('update.state.downloading.noSize') : t('update.state.downloading', { percent })
    }
    if (updatePhase === 'installing') return t('update.state.installing')
    if (updatePhase === 'error') return t('update.state.retry')
    if (update?.hasUpdate && update.latest) {
      return t('update.state.available', {
        version: update.latest.version,
        size: formatMb(update.latest.asset?.size ?? 0),
      })
    }
    if (update?.error) return t('update.state.unknown')
    if (checkedJustNow) return t('update.state.latest')
    // When there is no update and no error, say little: this row is really "kept only on this phone".
    return t('settings.about.local')
  }

  /**
   *   * Check manually once, bypassing the ten-minute cache.
   *   * Tapping this row means "is there a new version right now", so a cached answer won't do.
   */
  const checkNow = async () => {
    if (updatePhase === 'checking') return null
    setUpdatePhase('checking')
    setCheckedJustNow(false)
    try {
      // A hot update does not change the installed versionName, so comparing the
      // native version alone would keep offering a release we already run.
      const native = version ?? (await appVersion())
      const current = effectiveVersion(native, await readOtaTakenVersion()) ?? native
      const result = await checkForUpdate(current, true)
      setUpdate(result)
      setCheckedJustNow(true)
      if (result.hasUpdate && result.latest) {
        // The toast has no action attached, so the copy must not say "tap to
        // download"; it also must not linger once a download is under way or a
        // hot update is waiting for a restart.
        // Note: updatePhase is still 'checking' here, so gating on 'idle'
        // would suppress this toast entirely. Only a pending restart silences it.
        if (!otaReady) {
          toast(
            t('update.toast.available', {
              version: result.latest.version,
              size: formatMb(result.latest.asset?.size ?? 0),
            }),
          )
        }
      } else if (!result.error) {
        toast(t('update.state.latest'))
      }
      return result
    } catch {
      setCheckedJustNow(false)
      return null
    } finally {
      setUpdatePhase('idle')
    }
  }

  /**
   *   * Tapping the version row: check fresh first, then decide whether to download.
   *   * Downloading based on the cached version could already be a release behind — that would install the old build.
   */
  const checkThenUpdate = async () => {
    if (updatePhase === 'downloading' || updatePhase === 'installing') return
    const result = await checkNow()
    if (result?.hasUpdate) await handleUpdate()
  }

  /**
   *   * The update entry point the user tapped.
   *
   *   * Ask for a hot update first (a few MB, live after a restart); without one, download the full package (tens of MB, via the system installer).
   *   * Nothing downloads unless the user taps — automatic download is turned off.
   */
  const handleUpdate = async () => {
    // A download or install is already running: ignore further taps. The device
    // log showed four taps in 43 seconds, each starting another download into
    // the same temp file.
    if (updatePhase === 'downloading' || updatePhase === 'installing') return
    if (otaReady) {
      try {
        await applyOta()
      } catch {
        setUpdatePhase('error')
      }
      return
    }
    setUpdatePhase('downloading')
    try {
      const outcome = await checkOta()
      await opLog('update.ota', { kind: outcome.kind })
      if (outcome.kind === 'downloaded') {
        // Downloaded is not applied. Store what is waiting; promote it to "taken"
        // only after the app restarts into it (see the mount effect above).
        await writeOtaPendingVersion(update?.latest?.version)
        await writeOtaPending(true)
        setOtaReady(true)
        setUpdatePhase('idle')
        return
      }
    } catch (error) {
      // When hot updates aren't available (no channel configured, offline), carry on to the full package.
      await opLog('update.ota', { kind: 'failed' }, error)
    }
    await startUpdate()
  }

  /** Download + hand to the system installer. A mid-way failure must leave its reason in the subtitle, not flash by. */
  const startUpdate = async () => {
    if (!update?.latest?.asset) return
    const version = update.latest.version
    const size = update.latest.asset.size
    const startedAt = Date.now()
    setUpdatePhase('downloading')
    setProgress({ ratio: 0, written: 0, total: size })
    // Logged because otherwise a diagnostics dump cannot answer "did the
    // download start, and how long did it take".
    await opLog('update.download.start', { version, size })
    try {
      const name = update.latest.asset.name || `trovia-${version}.apk`
      const file = await downloadApk(update.latest.asset.url, name, (next) => setProgress(next))
      await opLog('update.download.done', { version, ms: Date.now() - startedAt })
      setUpdatePhase('installing')
      await opLog('update.install', { version })
      await installApk(file)
      setUpdatePhase('idle')
    } catch (error) {
      await opLog('update.fail', { version, stage: 'download' }, error)
      setUpdatePhase('error')
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
      // Same comparison the manual check uses. Using the raw native version here
      // made the row resurrect "new version" on every visit after a hot update.
      const taken = await readOtaTakenVersion()
      const current = effectiveVersion(next, taken) ?? next
      void checkForUpdate(current, false)
        .then(setUpdate)
        .catch(() => setUpdate(null))
      // A downloaded bundle is only "applied" once the app is actually running it.
      // Marking it applied at download time made the row claim the app was current while
      // the old JavaScript was still on screen — the user updates, and nothing changes.
      const state = await readOtaState().catch(() => null)
      setRunningOta(Boolean(state?.enabled && state.runningUpdate))
      const pending = await readOtaPending()
      if (state?.runningUpdate && pending) {
        const waitingVersion = await readOtaPendingVersion()
        await recordOtaTakenVersion(waitingVersion)
        await writeOtaPending(false)
        await writeOtaPendingVersion(null)
      } else if (pending) {
        setOtaReady(true)
      }
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
              valueIcon={update?.hasUpdate || otaReady ? 'arrow-up-circle' : undefined}
              busy={updatePhase === 'checking'}
              onPress={() => {
                if (otaReady) void handleUpdate()
                else void checkThenUpdate()
              }}
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
