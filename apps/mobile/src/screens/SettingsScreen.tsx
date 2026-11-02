import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps, ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppTabBar, TAB_BAR_HEIGHT } from '../components/AppTabBar'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Divider } from '../ui/Divider'
import { Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'
import { emitChange } from '../local/bus'
import { clearAllDocuments } from '../local/db'
import { writeExport } from '../local/exporter'
import { listAllForExport } from '../local/repo'
import { loadLlmState } from '../local/llm'
import * as repo from '../local/repo'
import type { DocumentStats } from '../local/repo'
import { useLocalRevision } from '../local/useLocalRevision'
import { useToast } from '../providers/ToastProvider'

const APP_NAME = 'Trovia'

type IconName = ComponentProps<typeof Ionicons>['name']

function statsLine(stats: DocumentStats | null): string {
  if (stats === null) return '读取中…'
  if (stats.total === 0) return '还没有收藏'
  const parts = [`${stats.total} 条`]
  if (stats.processing > 0) parts.push(`${stats.processing} 篇整理中`)
  if (stats.failed > 0) parts.push(`${stats.failed} 篇失败`)
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
  const router = useRouter()
  const { toast } = useToast()
  const revision = useLocalRevision()
  const insets = useSafeAreaInsets()

  const [stats, setStats] = useState<DocumentStats | null>(null)
  const [llmLabel, setLlmLabel] = useState('读取中…')
  const [exporting, setExporting] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const bottomPad = insets.bottom + TAB_BAR_HEIGHT + 24

  const reload = useCallback(async () => {
    try {
      const [nextStats, llm] = await Promise.all([repo.documentStats(), loadLlmState()])
      setStats(nextStats)
      setLlmLabel(llm.enabled ? `已开启 · ${llm.model || '未命名模型'}` : '关闭')
    } catch {
      // 读本地库失败时保持上一次的值，不打断用户。
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload, revision]),
  )

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const docs = await listAllForExport()
      if (docs.length === 0) {
        toast('还没有可以导出的收藏。', { type: 'warning' })
        return
      }
      const result = await writeExport(docs)
      if (!result) {
        toast('这台设备上暂时无法写入文件。', { type: 'error' })
        return
      }
      const Sharing = await import('expo-sharing')
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.jsonPath, { mimeType: 'application/json', dialogTitle: '导出收藏' })
      }
      toast(`已导出 ${docs.length} 条，JSON 与 Markdown 都写好了。`, { type: 'success' })
    } catch {
      toast('导出失败，请稍后重试。', { type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  async function handleClear() {
    try {
      await clearAllDocuments()
      emitChange()
      await reload()
      toast('已清空本机收藏。', { type: 'success' })
    } catch {
      toast('清空失败，请稍后重试。', { type: 'error' })
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
      >
        <View className="h-14 justify-center">
          <Text className="text-heading font-semibold text-ink">我的</Text>
        </View>
        <Text className="mb-6 text-caption text-faint">本机 · 没有账号，内容不上传</Text>

        <View className="mb-6">
          <SectionLabel>同步</SectionLabel>
          <Group>
            <Row
              icon="cloud-offline-outline"
              title="多端同步"
              subtitle="暂未开启，后续版本接入"
              value="未开启"
            />
            <Row
              icon="phone-portrait-outline"
              title="本机存储"
              subtitle="正文、摘要与索引都在 xunji.db"
              value={statsLine(stats)}
            />
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>整理</SectionLabel>
          <Group>
            <Row
              icon="sparkles-outline"
              title="大模型摘要"
              subtitle="用自己的模型写摘要与关键词"
              value={llmLabel}
              onPress={() => router.push('/settings/llm')}
              accessibilityLabel="打开大模型设置"
            />
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>数据</SectionLabel>
          <Group>
            <Row
              icon="download-outline"
              title="导出全部收藏"
              subtitle={exporting ? '正在写入文件…' : 'JSON 备份 + 可读 Markdown，随时带走'}
              value={stats ? `${stats.total} 条` : undefined}
              onPress={() => void handleExport()}
              accessibilityLabel="导出全部收藏"
            />
            <Row
              icon="trash-outline"
              title="清空全部收藏"
              subtitle="删除本机正文、摘要与索引，无法恢复"
              danger
              onPress={() => setConfirmingClear(true)}
              accessibilityLabel="清空全部收藏"
            />
          </Group>
        </View>

        <View className="mb-6">
          <SectionLabel>关于</SectionLabel>
          <Group>
            <Row
              icon="information-circle-outline"
              title={APP_NAME}
              subtitle="只保存在这台手机上"
              value={`v${Constants.expoConfig?.version ?? '—'}`}
            />
          </Group>
        </View>

        <Text className="mt-2 text-center text-caption text-faint">
          链接与图片由本机解析，图片文字用端侧 OCR 识别，不会上传。
        </Text>
      </ScrollView>
      <AppTabBar active="settings" />
      <ConfirmDialog
        visible={confirmingClear}
        title="清空全部收藏？"
        message="本机的正文、摘要和索引都会被删除，无法恢复。大模型设置会保留。"
        confirmLabel="清空"
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
