import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { FORMAT_LABELS } from '../local/import/parse'
import { pickAndParse, runImport } from '../local/import/service'
import type { ImportProgress, ImportSummary, PickedFile } from '../local/import/service'
import { processPendingQueue } from '../local/pipeline'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { GUTTER, Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'

/**
 * 导入：选文件 → 看清会导入什么 → 确认 → 逐条入队。
 *
 * 关键是「确认前把话说清楚」：识别到多少条、多少条已经有了、多少条读不出来。
 * 一次性把几百条链接塞进数据库却不说清楚，用户会以为数据被弄乱了。
 */
export function ImportScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [picked, setPicked] = useState<PickedFile | null>(null)
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
        toast('这个文件里没有读到可导入的链接。', { type: 'warning' })
        return
      }
      setPicked(result)
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取文件失败。', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handleImport() {
    if (!picked || busy) return
    setBusy(true)
    setProgress({ done: 0, total: picked.fresh.length })
    try {
      const result = await runImport(picked.fresh, setProgress)
      setSummary(result)
      setPicked(null)
      void processPendingQueue()
      toast(`已加入 ${result.created} 条，正在后台整理。`, { type: 'success' })
    } catch {
      toast('导入中断了，已经写入的条目保留着。', { type: 'error' })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Screen>
      <View className="h-14 flex-row items-center justify-between">
        <IconButton name="chevron-back" onPress={goBack} accessibilityLabel="返回" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-title font-semibold text-ink">导入收藏</Text>
        <Text className="mt-2 text-body-sm text-muted">
          支持浏览器导出的书签 HTML、Chrome / Edge 的书签 JSON、CSV 表格，以及一行一个链接的纯文本。
          导入只加入待整理队列，正文会在后台慢慢抓取。
        </Text>

        {summary ? (
          <View className="mt-8">
            <Text className="text-body text-ink">
              已导入 {summary.created} 条
              {summary.duplicate > 0 ? `，跳过重复 ${summary.duplicate} 条` : ''}
              {summary.failed > 0 ? `，失败 ${summary.failed} 条` : ''}。
            </Text>
            <Text className="mt-1 text-body-sm text-muted">正文正在后台整理，可以先去收藏页看进度。</Text>
            <View className="mt-6 flex-row gap-3">
              <Button label="去收藏看看" onPress={() => router.replace('/documents')} size="sm" variant="primary" />
              <Button label="再导入一次" onPress={() => void handlePick()} size="sm" variant="secondary" />
            </View>
          </View>
        ) : picked ? (
          <View className="mt-8">
            <Text className="text-caption font-semibold text-muted">文件</Text>
            <Text className="mt-1 text-body text-ink" numberOfLines={2}>
              {picked.name}
            </Text>
            <Text className="mt-1 text-caption text-faint">{FORMAT_LABELS[picked.format]}</Text>

            <View className="mt-6 gap-2">
              <Line label="识别到" value={`${picked.items.length} 条链接`} color={p.ink} />
              <Line label="已经收藏过" value={`${picked.existing} 条`} color={p.muted} />
              <Line label="本次会新增" value={`${picked.fresh.length} 条`} color={p.accent} />
              {picked.skipped.length > 0 ? (
                <Line label="跳过" value={`${picked.skipped.length} 行`} color={p.warn} />
              ) : null}
            </View>

            {picked.skipped.length > 0 ? (
              <View className="mt-4">
                <Text className="text-caption text-faint">跳过的内容（最多显示 3 条）</Text>
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
                  progress ? `导入中 ${progress.done}/${progress.total}` : `导入 ${picked.fresh.length} 条`
                }
                onPress={() => void handleImport()}
                loading={busy && Boolean(progress)}
                disabled={busy || picked.fresh.length === 0}
                size="sm"
                variant="primary"
              />
              <TextButton label="换个文件" onPress={() => void handlePick()} tone="muted" />
            </View>
          </View>
        ) : (
          <View className="mt-8">
            <Button
              label={busy ? '正在读取…' : '选择文件'}
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
