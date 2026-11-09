import { useCallback, useRef, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, Switch, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { buildVectors, loadEmbedConfig, vectorStats } from '../local/embed'
import { DEFAULT_LLM, isLocalEndpoint, listModels, loadLlmState, saveLlmState, testLlmConnection } from '../local/llm'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { Screen } from '../ui/Screen'
import { TextField } from '../ui/TextField'
import { Ionicons } from '@expo/vector-icons'

import { opLog } from '../local/dev-log'
import { CUSTOM_PROVIDER_ID, LLM_PRESETS, matchPreset } from '../local/llm-presets'
import { isChatModel } from '../local/llm-models'
import { SelectField } from '../ui/SelectField'
import { useKeepAboveKeyboard } from '../ui/use-keep-above-keyboard'
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
  const preset = matchPreset(baseUrl)
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelFailed, setModelFailed] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [customChosen, setCustomChosen] = useState(false)
  // The list is a convenience, not a cage: a model the provider does not return
  // (a preview id, a self-hosted gateway) still has to be usable.
  const [manualModel, setManualModel] = useState(false)
  // Android does not scroll a focused input into view on its own; each field gets
  // a wrapper to measure and a handler that brings it above the keyboard.
  const { scrollRef, contentRef, keepVisible, keyboardHeight } = useKeepAboveKeyboard()
  const urlField = useRef<React.ComponentRef<typeof View>>(null)
  const modelField = useRef<React.ComponentRef<typeof View>>(null)
  const embedField = useRef<React.ComponentRef<typeof View>>(null)
  const keyField = useRef<React.ComponentRef<typeof View>>(null)

  const openModelPicker = async () => {
    setPickerOpen(true)
    if (modelList || modelLoading) return
    setModelLoading(true)
    setModelFailed(false)
    try {
      const ids = (await listModels({ baseUrl }, apiKey)).filter(isChatModel)
      setModelList(ids)
    } catch {
      setModelFailed(true)
    } finally {
      setModelLoading(false)
    }
  }
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
      await opLog('llm.save', { enabled, intent, semantic, hasKey: Boolean(apiKey.trim()) || hasKey })
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
      await opLog('llm.test', { model })
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
      {/* Android needs this too: with edge-to-edge the window no longer resizes
          for the keyboard, so the "padding" behaviour is what keeps the focused
          field above it. */}
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <View className="h-14 flex-row items-center">
          <IconButton name="chevron-back" size={22} accessibilityLabel={t('detail.back')} onPress={goBack} />
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{
            paddingHorizontal: GUTTER,
            // Room to lift the last field above the keyboard.
            paddingBottom: insets.bottom + 32 + (keyboardHeight > 0 ? 96 : 0),
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View ref={contentRef} collapsable={false}>
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

          {/* Provider first: an empty address plus a model name the user has to
              know by heart is where this page used to lose people. */}
          <View className="mt-6">
            <Text className="mb-2 text-[11px] font-semibold tracking-[1px] text-muted">
              {t('llm.provider.title')}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {LLM_PRESETS.map((option) => {
                const active = preset?.id === option.id
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      void opLog('llm.provider', { id: option.id })
                      setBaseUrl(option.baseUrl)
                      setModel(option.model)
                      setEmbedModel(option.embedModel)
                    }}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={option.name}
                  >
                    <View
                      className={
                        active
                          ? 'rounded-full border border-ink px-3 py-1'
                          : 'rounded-full border border-line px-3 py-1'
                      }
                    >
                      <Text className={active ? 'text-caption text-ink' : 'text-caption text-muted'}>
                        {option.name}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
              {/* Custom is a state, not an address: picking it clears the fields
                  so they are obviously the user's to fill. */}
              <Pressable
                onPress={() => {
                  void opLog('llm.provider', { id: CUSTOM_PROVIDER_ID })
                  setCustomChosen(true)
                  setBaseUrl('')
                  setModel('')
                  setEmbedModel('')
                  setModelList(null)
                }}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityState={{ selected: customChosen && !preset }}
                accessibilityLabel={t('llm.provider.custom')}
              >
                <View
                  className={
                    customChosen && !preset
                      ? 'rounded-full border border-ink px-3 py-1'
                      : 'rounded-full border border-line px-3 py-1'
                  }
                >
                  <Text
                    className={
                      customChosen && !preset ? 'text-caption text-ink' : 'text-caption text-muted'
                    }
                  >
                    {t('llm.provider.custom')}
                  </Text>
                </View>
              </Pressable>
            </View>

            {preset ? (
              <View className="mt-2 flex-row items-center gap-3">
                <Text className="flex-1 text-caption text-muted">
                  {preset.id.startsWith('opencode')
                    ? t('llm.provider.opencode-zen')
                    : t('llm.provider.prefilled', { provider: preset.name })}
                </Text>
                {preset.keyUrl ? (
                  <Pressable
                    onPress={() => void Linking.openURL(preset.keyUrl!).catch(() => undefined)}
                    hitSlop={8}
                    accessibilityRole="link"
                  >
                    <Text className="text-caption text-accent underline">{t('llm.provider.getKey')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* These fields serve all three switches, so dim them only when every one is off. */}
          <View className={enabled || intent || semantic ? 'mt-6 gap-5' : 'mt-6 gap-5 opacity-45'}>
            <View ref={urlField} collapsable={false}>
            <TextField
              onFocus={keepVisible(urlField)}
              label={t('llm.field.baseUrl')}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={DEFAULT_LLM.baseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel={t('llm.field.baseUrl')}
            />
            </View>
            {manualModel ? (
              <View ref={modelField} collapsable={false}>
              <TextField
                onFocus={keepVisible(modelField)}
                label={t('llm.field.model')}
                value={model}
                onChangeText={setModel}
                placeholder={DEFAULT_LLM.model}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t('llm.field.model')}
              />
              </View>
            ) : (
              <SelectField
                label={t('llm.field.model')}
                value={model}
                placeholder={DEFAULT_LLM.model}
                onPress={() => void openModelPicker()}
                accessibilityLabel={t('llm.model.pick')}
              />
            )}
            <TextButton
              label={manualModel ? t('llm.model.useList') : t('llm.model.typeManually')}
              onPress={() => setManualModel((current) => !current)}
              tone="muted"
            />
            <View ref={embedField} collapsable={false}>
            <TextField
              onFocus={keepVisible(embedField, { fallbackToEnd: true })}
              label={t('llm.field.embed')}
              value={embedModel}
              onChangeText={setEmbedModel}
              placeholder={DEFAULT_LLM.embedModel}
              autoCapitalize="none"
              autoCorrect={false}
              hint={t('llm.field.embedHint')}
              accessibilityLabel={t('llm.field.embed')}
            />
            </View>
            <View ref={keyField} collapsable={false}>
            <TextField
              onFocus={keepVisible(keyField, { fallbackToEnd: true })}
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
          </View>
        </ScrollView>
      </KeyboardAvoidingView>


      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setPickerOpen(false)}>
          <Pressable className="max-h-[72%] rounded-t-xl bg-surface px-4 pb-8 pt-4" onPress={() => undefined}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-body font-semibold text-ink">{t('llm.model.title')}</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
                <Text className="text-caption text-muted">{t('llm.model.close')}</Text>
              </Pressable>
            </View>

            {modelLoading ? (
              <View className="flex-row items-center gap-2 py-6">
                <ActivityIndicator size="small" color={p.muted} />
                <Text className="text-caption text-muted">{t('llm.model.loading')}</Text>
              </View>
            ) : modelFailed ? (
              <View className="py-4">
                <Text className="text-caption text-muted">{t('llm.model.failed')}</Text>
                <TextButton
                  label={t('llm.model.typeManually')}
                  onPress={() => {
                    setManualModel(true)
                    setPickerOpen(false)
                  }}
                  tone="accent"
                />
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {(modelList ?? []).map((id) => (
                  <Pressable
                    key={id}
                    onPress={() => {
                      setModel(id)
                      setPickerOpen(false)
                    }}
                    className="flex-row items-center justify-between border-b border-line py-3"
                    accessibilityRole="button"
                    accessibilityState={{ selected: id === model }}
                  >
                    <Text
                      className={id === model ? 'flex-1 text-body-sm text-accent' : 'flex-1 text-body-sm text-ink'}
                      numberOfLines={1}
                    >
                      {id}
                    </Text>
                    {id === model ? <Ionicons name="checkmark" size={16} color={p.accent} /> : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  )
}
