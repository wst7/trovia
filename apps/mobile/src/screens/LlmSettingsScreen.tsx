import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DEFAULT_LLM, loadLlmState, saveLlmState, testLlmConnection } from '../local/llm'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton } from '../ui/Button'
import { Screen } from '../ui/Screen'
import { TextField } from '../ui/TextField'
import { GUTTER } from '../ui/Screen'
import { usePalette } from '../ui/palette'

/**
 * 大模型设置：可选功能，所以从「我的」点进来单独一屏。
 * 关闭时整体变淡——用户能看见配置，也知道它当前不生效。
 */
export function LlmSettingsScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [hasKey, setHasKey] = useState(false)
  const [enabled, setEnabled] = useState(DEFAULT_LLM.enabled)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LLM.baseUrl)
  const [model, setModel] = useState(DEFAULT_LLM.model)
  const [intent, setIntent] = useState(DEFAULT_LLM.intent)
  const [apiKey, setApiKey] = useState('')
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
      setHasKey(llm.hasKey)
    } catch {
      // 读不到就保持上一次的值，不打断用户。
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload]),
  )

  async function handleSave() {
    if (saving) return
    if (enabled) {
      if (!/^https?:\/\/\S+$/i.test(baseUrl.trim())) {
        toast('服务地址需要以 http:// 或 https:// 开头。', { type: 'error' })
        return
      }
      if (!model.trim()) {
        toast('请填写模型名称。', { type: 'error' })
        return
      }
      if (!hasKey && !apiKey.trim()) {
        toast('请填写 API Key，或先关闭大模型。', { type: 'error' })
        return
      }
    }

    setSaving(true)
    try {
      await saveLlmState({ enabled, baseUrl, model, intent }, apiKey.trim() ? apiKey : undefined)
      setApiKey('')
      await reload()
      toast(enabled ? '已保存，新收藏会用这个模型整理。' : '已保存，将使用本地抽取式摘要。', {
        type: 'success',
      })
    } catch {
      toast('保存设置失败，请稍后重试。', { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (testing) return
    if (!/^https?:\/\/\S+$/i.test(baseUrl.trim())) {
      toast('服务地址需要以 http:// 或 https:// 开头。', { type: 'error' })
      return
    }
    if (!hasKey && !apiKey.trim()) {
      toast('请先填写 API Key。', { type: 'error' })
      return
    }

    setTesting(true)
    try {
      const reply = await testLlmConnection({ enabled: true, baseUrl, model, intent }, apiKey)
      toast(`连接成功，模型回复：${reply}`, { type: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败'
      toast(`连接失败：${message}`, { type: 'error' })
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
          <IconButton name="chevron-back" size={22} accessibilityLabel="返回" onPress={goBack} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-title font-semibold text-ink">大模型</Text>
          <Text className="mt-2 text-body-sm text-muted">
            可选。打开后新收藏会交给你自己的模型写摘要与关键词；关闭时从原文离线抽取，不上传任何内容。
            搜索时只把这一句话发给模型，不会发送你的收藏内容。
          </Text>

          <View className="mt-6 flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-body-sm text-ink">用大模型写摘要</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: p.line, true: p.accent }}
              thumbColor={p.surface}
              ios_backgroundColor={p.line}
              accessibilityLabel="使用大模型写摘要"
            />
          </View>

          <View className="mt-4 flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-body-sm text-ink">用模型理解搜索意图</Text>
              <Text className="mt-1 text-caption text-muted">
                把「上次存的那篇讲睡眠的」这类话翻译成时间与关键词；不打开时只用本地规则。
              </Text>
            </View>
            <Switch
              value={intent}
              onValueChange={setIntent}
              trackColor={{ false: p.line, true: p.accent }}
              thumbColor={p.surface}
              ios_backgroundColor={p.line}
              accessibilityLabel="使用模型理解搜索意图"
            />
          </View>

          <View className={enabled ? 'mt-6 gap-5' : 'mt-6 gap-5 opacity-45'}>
            <TextField
              label="服务地址"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={DEFAULT_LLM.baseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="大模型服务地址"
            />
            <TextField
              label="模型名称"
              value={model}
              onChangeText={setModel}
              placeholder={DEFAULT_LLM.model}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="模型名称"
            />
            <TextField
              label="API Key"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={hasKey ? '已保存在系统钥匙串，留空则不修改' : '填写你的 API Key'}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              hint="密钥只写入系统钥匙串，不会上传，也不会出现在日志里。"
              accessibilityLabel="大模型 API Key"
            />
          </View>

          <View className="mt-6 flex-row gap-2">
            <Button
              label={saving ? '保存中…' : '保存设置'}
              onPress={() => void handleSave()}
              loading={saving}
              size="sm"
              variant="primary"
            />
            <Button
              label={testing ? '测试中…' : '测试连接'}
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
