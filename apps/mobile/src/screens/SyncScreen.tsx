import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { lastSyncAt, loadConfig, loadPassword, saveConfig } from '../local/sync-config'
import { describeReport, syncNow, SyncNotConfigured, testConnection } from '../local/sync-runner'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { GUTTER, Screen } from '../ui/Screen'
import { TextField } from '../ui/TextField'
import { useT } from '../i18n'

/**
 * 同步失败要说清楚是哪一类错。
 * 「稍后再试」对着一堆不同原因，用户只能干等；分清楚之后每个人都知道该改哪一项。
 */
function describeSyncError(
  error: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (error instanceof SyncNotConfigured) return t('sync.err.notConfigured')

  const message = error instanceof Error ? error.message : String(error)
  if (/401|unauthor/i.test(message)) return t('sync.err.unauthorized')
  if (/403/.test(message)) return t('sync.err.forbidden')
  if (/404/.test(message)) return t('sync.err.notFound')
  if (/abort|timeout|network|fetch/i.test(message)) return t('sync.err.network')
  return t('sync.err.other', { message: message.slice(0, 80) })
}

/**
 * 同步设置：填自己的网盘，不注册账号。
 *
 * 抄的是「WebDAV 就行」这条真实需求：用户手上的坚果云、群晖、Nextcloud
 * 都支持，不需要我们做 OAuth 审核，也没有中心服务器能读到内容。
 */
export function SyncScreen() {
  const t = useT()
  const router = useRouter()
  const { toast } = useToast()
  const insets = useSafeAreaInsets()

  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [folder, setFolder] = useState('trovia')
  const [lastAt, setLastAt] = useState<string | null>(null)
  const effectiveUrl = (() => {
    const base = baseUrl.trim().replace(/\/+$/, '')
    const sub = folder.trim().replace(/^\/+|\/+$/g, '')
    if (!base) return null
    // 地址里已经带了目录名（常见的手滑），提示出来比默默拼两遍好。
    return sub && !base.endsWith(`/${sub}`) ? `${base}/${sub}` : base
  })()
  const folderLooksDuplicated = Boolean(
    baseUrl.trim() && folder.trim() && baseUrl.trim().replace(/\/+$/, '').endsWith(`/${folder.trim()}`),
  )

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
      toast(t('sync.missingFields'), { type: 'warning' })
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
      toast(t('sync.testOk'), { type: 'success' })
      setResult(t('sync.statusOk'))
    } catch (error) {
      toast(describeSyncError(error, t), { type: 'error' })
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
      const reason = describeSyncError(error, t)
      toast(reason, { type: 'error' })
      setResult(reason)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen>
      <View className="h-14 flex-row items-center justify-between">
        <IconButton name="chevron-back" onPress={goBack} accessibilityLabel={t('detail.back')} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-title font-semibold text-ink">{t('settings.section.sync')}</Text>
          <Text className="mt-2 text-body-sm text-muted">{t('sync.intro')}</Text>

          {/* 地址和目录是拼起来的，填错时界面必须自己说出来：把最终会访问的
              地址显示出来，比让人对着两个输入框猜要省事得多。 */}
          {effectiveUrl ? (
            <Text className="mt-4 text-caption text-faint">
              {t('sync.effective', { url: effectiveUrl })}
            </Text>
          ) : null}
          {folderLooksDuplicated ? (
            <Text className="mt-1 text-caption text-warn">
              {t('sync.duplicated', { folder: folder.trim() })}
            </Text>
          ) : null}

          <View className="mt-8 gap-6">
            <TextField
              label={t('sync.label.server')}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://dav.jianguoyun.com/dav/"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextField
              label={t('sync.label.username')}
              value={username}
              onChangeText={setUsername}
              placeholder={t('sync.placeholder.email')}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextField
              label={t('sync.label.password')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('sync.hint.password')}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TextField
              label={t('sync.label.folder')}
              value={folder}
              onChangeText={setFolder}
              placeholder="trovia"
              autoCapitalize="none"
              autoCorrect={false}
              hint={t('sync.hint.folder')}
            />
          </View>

          <View className="mt-8 flex-row gap-3">
            <Button
              label={busy === 'test' ? t('sync.testing') : t('sync.test')}
              onPress={() => void handleTest()}
              variant="secondary"
              size="sm"
              loading={busy === 'test'}
              disabled={busy !== null}
            />
            <Button
              label={busy === 'sync' ? t('sync.syncing') : t('sync.now')}
              onPress={() => void handleSync()}
              variant="primary"
              size="sm"
              loading={busy === 'sync'}
              disabled={busy !== null || !configured}
            />
          </View>

          {result ? <Text className="mt-6 text-body-sm text-ink">{result}</Text> : null}
          {/* 文件数和收藏数对不上是常态：删除的条目在云端还留一个文件。 */}
          {result ? <Text className="mt-1 text-caption text-faint">{t('sync.filesNote')}</Text> : null}
          {lastAt ? (
            <Text className="mt-1 text-caption text-faint">
              {t('sync.lastAt', { when: lastAt.replace('T', ' ').slice(0, 16) })}
            </Text>
          ) : (
            <Text className="mt-1 text-caption text-faint">{t('sync.never')}</Text>
          )}

          <View className="mt-10">
            <Text className="text-caption text-muted">{t('sync.whatTitle')}</Text>
            <Text className="mt-1 text-caption text-faint">{t('sync.whatBody')}</Text>
          </View>


          <View className="mt-8">
            <TextButton
              label={t('sync.clearPassword')}
              tone="muted"
              onPress={() => {
                void (async () => {
                  await saveConfig({ baseUrl, username, folder }, '')
                  setPassword('')
                  toast(t('sync.cleared'), { type: 'success' })
                })()
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
