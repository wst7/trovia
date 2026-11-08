import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { opLog } from '../local/dev-log'
import { lastSyncAt, loadConfig, loadPassword, saveConfig } from '../local/sync-config'
import { describeReport, syncNow, SyncNotConfigured, testConnection } from '../local/sync-runner'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { GUTTER, Screen } from '../ui/Screen'
import { TextField } from '../ui/TextField'
import { useT } from '../i18n'

/**
 * A sync failure has to say which kind of error it was.
 * "Try again later" in the face of many different causes just makes the user wait; once they are told apart, everyone knows which field to fix.
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
 * Sync settings: point at your own cloud drive, no account to create.
 *
 * Built around the real requirement "WebDAV is enough": the Nutstore, Synology and Nextcloud
 * accounts users already have all work, with no OAuth review for us and no central server that can read the content.
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
    // The URL already includes the folder name (a common slip); pointing that out beats silently joining it twice.
    return sub && !base.endsWith(`/${sub}`) ? `${base}/${sub}` : base
  })()
  const folderLooksDuplicated = Boolean(
    baseUrl.trim() && folder.trim() && baseUrl.trim().replace(/\/+$/, '').endsWith(`/${folder.trim()}`),
  )

  const [confirmingClear, setConfirmingClear] = useState(false)
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
    await opLog('sync.config.save', { hasPassword: Boolean(password) })
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

          {/* The URL and folder are joined together, so the UI must speak up when they're wrong: showing the final address
              is far less work than making people guess across two inputs. */}
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
              label={busy === 'test' ? t('sync.testing') : t('sync.testAndSave')}
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
          {/* The file count not matching the saved count is normal: deleted items still leave a file in the cloud. */}
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
              // Clearing the saved password cannot be undone from here: ask first.
              onPress={() => setConfirmingClear(true)}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirmingClear}
        title={t('sync.clearPassword')}
        message={t('sync.clearConfirm')}
        confirmLabel={t('sync.clearPassword')}
        destructive
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false)
          void (async () => {
            await saveConfig({ baseUrl, username, folder }, '')
            await opLog('sync.password.clear')
            setPassword('')
            toast(t('sync.cleared'), { type: 'success' })
          })()
        }}
      />
    </Screen>
  )
}
