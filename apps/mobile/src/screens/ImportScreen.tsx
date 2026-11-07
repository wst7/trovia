import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { addedRange } from '../local/import/parse'
import { pickAndParse, runImport, runRestore } from '../local/import/service'
import type { ImportProgress, ImportSummary, PickedFile } from '../local/import/service'
import { processPendingQueue } from '../local/pipeline'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { GUTTER, Screen } from '../ui/Screen'
import { useT } from '../i18n'
import { usePalette } from '../ui/palette'

/**
 * Import: pick a file → see what will be imported → confirm → enqueue item by item.
 *
 * The key is "say it plainly before confirming": how many were recognized, how many already exist, how many can't be read.
 * Stuffing hundreds of links into the database at once without saying so makes users think their data got scrambled.
 */
export function ImportScreen() {
  const t = useT()
  const router = useRouter()
  const { toast } = useToast()
  const insets = useSafeAreaInsets()

  const p = usePalette()

  const [picked, setPicked] = useState<PickedFile | null>(null)

  const importedRange = addedRange(picked?.items ?? [])

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/settings')
  }

  async function handlePick() {
    if (busy) return
    setBusy(true)
    setSummary(null)
    try {
      const result = await pickAndParse()
      if (!result) return
      if (result.items.length === 0) {
        toast(t('import.noLinks'), { type: 'warning' })
        return
      }
      setPicked(result)
    } catch (error) {
      toast(error instanceof Error ? error.message : t('import.readFailed'), { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handleImport() {
    if (!picked || busy) return
    const restoring = (picked.documents?.length ?? 0) > 0
    setBusy(true)
    setProgress({ done: 0, total: restoring ? picked.documents!.length : picked.fresh.length })
    try {
      // A backup file carries the body and goes straight into the database; a plain bookmark file carries only links and has to be parsed.
      const result = restoring
        ? await runRestore(picked.documents!, setProgress, picked.name)
        : await runImport(picked.fresh, setProgress, picked.name)
      setSummary(result)
      setPicked(null)
      if (!restoring) void processPendingQueue()
      toast(
        restoring
          ? t('import.restored', {
              count: result.created,
              extra:
                result.duplicate > 0
                  ? t('import.restoredDuplicate', { count: result.duplicate })
                  : '',
            })
          : t('import.added', { count: result.created }),
        { type: 'success' },
      )
      // After importing, go straight to the saved page with "only imported" on: otherwise the user comes back to a list of "organizing" rows
      // and can't tell which ones just arrived.
      if (result.created > 0) router.replace('/documents?imported=1')
    } catch {
      toast(t('import.interrupted'), { type: 'error' })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Screen>
      <View className="h-14 flex-row items-center justify-between">
        <IconButton name="chevron-back" onPress={goBack} accessibilityLabel={t('detail.back')} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-title font-semibold text-ink">{t('settings.import.title')}</Text>
        <Text className="mt-2 text-body-sm text-muted">{t('import.intro')}</Text>

        {summary ? (
          <View className="mt-8">
            <Text className="text-body text-ink">
              {t('import.result', { count: summary.created })}
              {summary.duplicate > 0
                ? t('import.resultDuplicate', { count: summary.duplicate })
                : ''}
              {summary.failed > 0 ? t('import.resultFailed', { count: summary.failed }) : ''}.
            </Text>
            <Text className="mt-1 text-body-sm text-muted">{t('import.resultHint')}</Text>
            <View className="mt-6 flex-row gap-3">
              <Button
                label={t('import.goDocuments')}
                onPress={() => router.replace('/documents')}
                size="sm"
                variant="primary"
              />
              <Button
                label={t('import.again')}
                onPress={() => void handlePick()}
                size="sm"
                variant="secondary"
              />
            </View>
          </View>
        ) : picked ? (
          <View className="mt-8">
            <Text className="text-caption font-semibold text-muted">{t('import.file')}</Text>
            <Text className="mt-1 text-body text-ink" numberOfLines={2}>
              {picked.name}
            </Text>
            <Text className="mt-1 text-caption text-faint">{t(`import.format.${picked.format}`)}</Text>
            {picked.documents?.length ? (
              <Text className="mt-2 text-caption text-muted">{t('import.restoreHint')}</Text>
            ) : null}

            <View className="mt-6 gap-2">
              <Line
                label={t('import.detected')}
                value={t('import.detectedValue', { count: picked.items.length })}
                color={p.ink}
              />
              <Line
                label={t('import.existing')}
                value={t('import.detectedValue', { count: picked.existing })}
                color={p.muted}
              />
              <Line
                label={t('import.new')}
                value={t('import.detectedValue', { count: picked.fresh.length })}
                color={p.accent}
              />
              {importedRange ? (
                // Exports with timestamps (Pocket, bookmarks) carry the original saved time in; say so up front,
                // so the user doesn't think hundreds of old saves all became "today".
                <Line label={t('import.savedTime')} value={importedRange} color={p.muted} />
              ) : null}
              {picked.skipped.length > 0 ? (
                <Line
                  label={t('import.skippedLabel')}
                  value={t('import.skippedValue', { count: picked.skipped.length })}
                  color={p.warn}
                />
              ) : null}
            </View>

            {picked.skipped.length > 0 ? (
              <View className="mt-4">
                <Text className="text-caption text-faint">{t('import.skippedTitle')}</Text>
                {picked.skipped.slice(0, 3).map((row, index) => (
                  <Text key={`${row.line}-${index}`} className="mt-1 text-caption text-muted" numberOfLines={1}>
                    {row.reason}：{row.line}
                  </Text>
                ))}
              </View>
            ) : null}

            <View className="mt-8 flex-row gap-3">
              <Button
                label={
                  progress
                    ? t('import.importing', { done: progress.done, total: progress.total })
                    : picked.documents?.length
                      ? t('import.restoreCount', { count: picked.documents.length })
                      : t('import.importCount', { count: picked.fresh.length })
                }
                onPress={() => void handleImport()}
                loading={busy && Boolean(progress)}
                disabled={busy || picked.fresh.length === 0}
                size="sm"
                variant="primary"
              />
              <TextButton label={t('import.otherFile')} onPress={() => void handlePick()} tone="muted" />
            </View>
          </View>
        ) : (
          <View className="mt-8">
            <Button
              label={busy ? t('import.reading') : t('import.choose')}
              onPress={() => void handlePick()}
              loading={busy}
              size="sm"
              variant="primary"
            />
            <Text className="mt-4 text-caption text-faint">
              书签文件一般这样拿到：Chrome 桌面版「书签管理器 → 导出书签」，Safari「文件 → 导出 → 书签」。
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

function Line({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View className="flex-row items-baseline justify-between">
      <Text className="text-body-sm text-muted">{label}</Text>
      <Text className="text-body-sm" style={{ color }}>
        {value}
      </Text>
    </View>
  )
}
