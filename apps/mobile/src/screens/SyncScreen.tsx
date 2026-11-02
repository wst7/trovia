import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { lastSyncAt, loadConfig, loadPassword, saveConfig } from '../local/sync-config'
import { describeReport, syncNow, SyncNotConfigured, testConnection } from '../local/sync-runner'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { GUTTER, Screen } from '../ui/Screen'
import { TextField } from '../ui/TextField'

/**
 * 同步失败要说清楚是哪一类错。
 * 「稍后再试」对着一堆不同原因，用户只能干等；分清楚之后每个人都知道该改哪一项。
 */
function describeSyncError(error: unknown): string {
  if (error instanceof SyncNotConfigured) return '还没填好同步账户。'

  const message = error instanceof Error ? error.message : String(error)
  if (/401|unauthor/i.test(message)) return '网盘拒绝了这组账号密码。坚果云要用「应用密码」。'
  if (/403/.test(message)) return '这个账号没有该目录的写入权限。'
  if (/404/.test(message)) return '地址不对：路径要找得到 WebDAV 根目录。'
  if (/abort|timeout|network|fetch/i.test(message)) return '连不上网盘，检查网络或服务器地址。'
  return `同步没有完成：${message.slice(0, 80)}`
}

/**
 * 同步设置：填自己的网盘，不注册账号。
 *
 * 抄的是「WebDAV 就行」这条真实需求：用户手上的坚果云、群晖、Nextcloud
 * 都支持，不需要我们做 OAuth 审核，也没有中心服务器能读到内容。
 */
export function SyncScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const insets = useSafeAreaInsets()

  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [folder, setFolder] = useState('trovia')
  const [lastAt, setLastAt] = useState<string | null>(null)
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const config = await loadConfig()
      setBaseUrl(config.baseUrl)
      setUsername(config.username)
      setFolder(config.folder)
      setPassword(await loadPassword())
      setLastAt(await lastSyncAt())
    })()
  }, [])

  const configured = baseUrl.trim().length > 0 && username.trim().length > 0 && password.length > 0

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/settings')
  }

  async function persist(): Promise<boolean> {
    if (!baseUrl.trim() || !username.trim() || !password) {
      toast('地址、用户名、密码都要填。坚果云要用「应用密码」，不是登录密码。', { type: 'warning' })
      return false
    }
    await saveConfig({ baseUrl: baseUrl.trim(), username: username.trim(), folder: folder.trim() || 'trovia' }, password)
    return true
  }

  async function handleTest() {
    if (busy) return
    if (!(await persist())) return
    setBusy('test')
    try {
      await testConnection()
      toast('连上了，目录可读写。', { type: 'success' })
      setResult('连接正常')
    } catch (error) {
      toast(describeSyncError(error), { type: 'error' })
      setResult(null)
    } finally {
      setBusy(null)
    }
  }

  async function handleSync() {
    if (busy) return
    if (!(await persist())) return
    setBusy('sync')
    try {
      const report = await syncNow()
      const line = describeReport(report)
      setResult(line)
      toast(line, { type: 'success' })
      setLastAt(await lastSyncAt())
    } catch (error) {
      const reason = describeSyncError(error)
      toast(reason, { type: 'error' })
      setResult(reason)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen>
      <View className="h-14 flex-row items-center justify-between">
        <IconButton name="chevron-back" onPress={goBack} accessibilityLabel="返回" />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-title font-semibold text-ink">同步</Text>
          <Text className="mt-2 text-body-sm text-muted">
            内容写进你自己的网盘，我们不经过任何服务器。坚果云、群晖、Nextcloud 这类支持 WebDAV 的都可以。
          </Text>

          <View className="mt-8 gap-6">
            <TextField
              label="服务器地址"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://dav.jianguoyun.com/dav/"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextField
              label="用户名"
              value={username}
              onChangeText={setUsername}
              placeholder="邮箱"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextField
              label="应用密码"
              value={password}
              onChangeText={setPassword}
              placeholder="坚果云：账户信息 → 安全选项 → 添加应用"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TextField
              label="远端目录"
              value={folder}
              onChangeText={setFolder}
              placeholder="trovia"
              autoCapitalize="none"
              autoCorrect={false}
              hint="目录不存在会自动创建，只往这个目录里写。"
            />
          </View>

          <View className="mt-8 flex-row gap-3">
            <Button
              label={busy === 'test' ? '正在连接…' : '测试连接'}
              onPress={() => void handleTest()}
              variant="secondary"
              size="sm"
              loading={busy === 'test'}
              disabled={busy !== null}
            />
            <Button
              label={busy === 'sync' ? '正在同步…' : '立即同步'}
              onPress={() => void handleSync()}
              variant="primary"
              size="sm"
              loading={busy === 'sync'}
              disabled={busy !== null || !configured}
            />
          </View>

          {result ? <Text className="mt-6 text-body-sm text-ink">{result}</Text> : null}
          {lastAt ? (
            <Text className="mt-1 text-caption text-faint">上次同步 {lastAt.replace('T', ' ').slice(0, 16)}</Text>
          ) : (
            <Text className="mt-1 text-caption text-faint">还没有同步过。</Text>
          )}

          <View className="mt-10">
            <Text className="text-caption text-muted">同步什么</Text>
            <Text className="mt-1 text-caption text-faint">
              收藏的标题、正文、摘要、关键词与来源链接。图片保存在本机，不会上传；换设备后图片会在重新解析时补上。
            </Text>
          </View>

          <View className="mt-6">
            <Text className="text-caption text-muted">冲突怎么办</Text>
            <Text className="mt-1 text-caption text-faint">
              两台设备都改过同一条时，新的那份占主位，另一份留成「（冲突副本）」，不会悄悄丢掉。
            </Text>
          </View>

          <View className="mt-8">
            <TextButton
              label="清除已保存的密码"
              tone="muted"
              onPress={() => {
                void (async () => {
                  await saveConfig({ baseUrl, username, folder }, '')
                  setPassword('')
                  toast('已清除密码，内容仍保留在本机。', { type: 'success' })
                })()
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
