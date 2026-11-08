import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView, Switch, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { buildVectors, loadEmbedConfig, vectorStats } from '../local/embed'
import { DEFAULT_LLM, isLocalEndpoint, loadLlmState, saveLlmState, testLlmConnection } from '../local/llm'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { Screen } from '../ui/Screen'
import { TextField } from '../ui/TextField'
import { useT } from '../i18n'
import { GUTTER } from '../ui/Screen'
import { usePalette } from '../ui/palette'

/**
 * LLM settings: an optional feature, so it gets its own screen reached from "Me".
 * When it is switched off the whole screen dims — users can see the configuration and know it is not currently in effect.
 */
export function LlmSettingsScreen() {
  const t = useT()
  const router = useRouter()
  const { toast } = useToast()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [hasKey, setHasKey] = useState(false)
  const [enabled, setEnabled] = useState(DEFAULT_LLM.enabled)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LLM.baseUrl)
  const [model, setModel] = useState(DEFAULT_LLM.model)
  const [intent, setIntent] = useState(DEFAULT_LLM.intent)
  const [embedModel, setEmbedModel] = useState(DEFAULT_LLM.embedModel)
  const [semantic, setSemantic] = useState(DEFAULT_LLM.semantic)
  const [indexed, setIndexed] = useState<{ indexed: number; total: number } | null>(null)
  const [building, setBuilding] = useState(false)
  const [apiKey, setApiKey] = useState('')
  /**
   * The switches are drawn immediately, but without an address or key they cannot
   * do anything; validating only on save means the user flips them on, presses
   * save, and then gets told to go fill something in. Only switching on is
   * blocked — anything already on must still be switchable off.
   */
  const needsKey = !hasKey && !apiKey.trim() && !isLocalEndpoint(baseUrl)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/settings')
  }, [router])

  const reload = useCallback(async () => {
    try {
      const llm = await loadLlmState()
      setEnabled(llm.enabled)
      setBaseUrl(llm.baseUrl)
      setModel(llm.model)
      setIntent(llm.intent)
      setEmbedModel(llm.embedModel)
      setSemantic(llm.semantic)
      setHasKey(llm.hasKey)
    } catch {
      // If it cannot be read, keep the previous values and do not interrupt the user.
    }
  }, [])

  const reloadIndex = useCallback(async () => {
    const config = await loadEmbedConfig()
    if (!config) {
      setIndexed(null)
      return
    }
    setIndexed(await vectorStats(config.model))
  }, [])

  async function handleBuildIndex() {
    if (building) return
    setBuilding(true)
    try {
      const added = await buildVectors(40)
      await reloadIndex()
      toast(added > 0 ? t('llm.indexed', { count: added }) : t('llm.indexNothing'), {
        type: 'success',
      })
    } catch {
      toast(t('llm.indexFailed'), { type: 'error' })
    } finally {
      setBuilding(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      void reload().then(reloadIndex)
    }, [reload, reloadIndex]),
  )

  async function handleSave() {
    if (saving) return
    if (enabled) {
      if (!/^https?:\/\/\S+$/i.test(baseUrl.trim())) {
        toast(t('llm.needUrl'), { type: 'error' })
        return
      }
      if (!model.trim()) {
        toast(t('llm.needModel'), { type: 'error' })
        return
      }
      // A local service needs no key; only a remote address makes one mandatory.
      if (!hasKey && !apiKey.trim() && !isLocalEndpoint(baseUrl)) {
        toast(t('llm.needKey'), { type: 'error' })
        return
      }
    }

    setSaving(true)
    try {
      await saveLlmState({ enabled, baseUrl, model, intent, embedModel, semantic }, apiKey.trim() ? apiKey : undefined)
      setApiKey('')
      await reload()
      await reloadIndex()
      toast(enabled ? t('llm.savedOn') : t('llm.savedOff'), {
        type: 'success',
      })
    } catch {
      toast(t('llm.saveFailed'), { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (testing) return
    if (!/^https?:\/\/\S+$/i.test(baseUrl.trim())) {
      toast(t('llm.needUrl'), { type: 'error' })
      return
    }
    if (!hasKey && !apiKey.trim()) {
      toast(t('llm.needKeyOnly'), { type: 'error' })
      return
    }

    setTesting(true)
    try {
      const reply = await testLlmConnection({ enabled: true, baseUrl, model, intent, embedModel, semantic }, apiKey)
      toast(t('llm.testOk', { reply }), { type: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      toast(t('llm.testFailed', { message }), { type: 'error' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="h-14 flex-row items-center">
          <IconButton name="chevron-back" size={22} accessibilityLabel={t('detail.back')} onPress={goBack} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-title font-semibold text-ink">{t('llm.title')}</Text>
          <Text className="mt-2 text-body-sm text-muted">{t('llm.intro')}</Text>

          <View className="mt-6 flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-body-sm text-ink">{t('llm.switch.summary')}</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              disabled={needsKey && !enabled}
              trackColor={{ false: p.line, true: p.accent }}
              thumbColor={p.surface}
              ios_backgroundColor={p.line}
              accessibilityLabel={t('llm.switch.summary')}
            />
          </View>

          <View className="mt-4 flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-body-sm text-ink">{t('llm.switch.intent')}</Text>
              <Text className="mt-1 text-caption text-muted">{t('llm.switch.intentHint')}</Text>
            </View>
            <Switch
              value={intent}
              onValueChange={setIntent}
              disabled={needsKey && !intent}
              trackColor={{ false: p.line, true: p.accent }}
              thumbColor={p.surface}
              ios_backgroundColor={p.line}
              accessibilityLabel={t('llm.switch.intent')}
            />
          </View>

          <View className="mt-4 flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-body-sm text-ink">{t('llm.switch.semantic')}</Text>
              <Text className="mt-1 text-caption text-muted">{t('llm.switch.semanticHint')}</Text>
            </View>
            <Switch
              value={semantic}
              onValueChange={setSemantic}
              disabled={needsKey && !semantic}
              trackColor={{ false: p.line, true: p.accent }}
              thumbColor={p.surface}
              ios_backgroundColor={p.line}
              accessibilityLabel={t('llm.switch.semantic')}
            />
          </View>

          {needsKey ? (
            <Text className="mt-3 text-caption text-muted">{t('llm.needKeyToToggle')}</Text>
          ) : null}

          {/* These fields serve all three switches, so dim them only when every one is off. */}
          <View className={enabled || intent || semantic ? 'mt-6 gap-5' : 'mt-6 gap-5 opacity-45'}>
            <TextField
              label={t('llm.field.baseUrl')}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={DEFAULT_LLM.baseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel={t('llm.field.baseUrl')}
            />
            <TextField
              label={t('llm.field.model')}
              value={model}
              onChangeText={setModel}
              placeholder={DEFAULT_LLM.model}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t('llm.field.model')}
            />
            <TextField
              label={t('llm.field.embed')}
              value={embedModel}
              onChangeText={setEmbedModel}
              placeholder={DEFAULT_LLM.embedModel}
              autoCapitalize="none"
              autoCorrect={false}
              hint={t('llm.field.embedHint')}
              accessibilityLabel={t('llm.field.embed')}
            />
            <TextField
              label="API Key"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={
                hasKey ? t('llm.field.keyPlaceholderSet') : t('llm.field.keyPlaceholderEmpty')
              }
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              hint={t('llm.field.keyHint')}
              accessibilityLabel="API Key"
            />
          </View>

          <View className="mt-6 flex-row items-center justify-between">
            <Text className="text-body-sm text-muted">
              {indexed === null
                ? t('llm.index.none')
                : t('llm.index.count', { done: indexed.indexed, total: indexed.total })}
            </Text>
            <TextButton label={t('llm.buildIndex')} onPress={() => void handleBuildIndex()} tone="muted" />
          </View>
          {semantic && indexed !== null && indexed.indexed === 0 ? (
            <Text className="mt-2 text-caption text-muted">{t('llm.semanticNoIndex')}</Text>
          ) : null}

          <View className="mt-4 flex-row gap-2">
            <Button
              label={saving ? t('llm.saving') : t('llm.save')}
              onPress={() => void handleSave()}
              loading={saving}
              size="sm"
              variant="primary"
            />
            <Button
              label={testing ? t('llm.testing') : t('llm.test')}
              onPress={() => void handleTest()}
              loading={testing}
              size="sm"
              variant="secondary"
            />
          </View>

          <Text className="mt-8 text-caption text-faint">
            兼容任何 OpenAI 格式的 chat/completions 服务：OpenAI、DeepSeek、Moonshot、自建网关都可以。
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
