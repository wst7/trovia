/**
 * "Ask the model" screen: a short conversation over the local library.
 *
 * It used to be one question, one answer. Follow-ups like "and the second one?"
 * are half of what people actually type, so the screen keeps the turns and sends them
 * back as context: the model sees what it already said.
 *
 * Still not a chat log that grows forever — the tool calls are shown per turn so
 * the user can see what was looked through before trusting the answer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native'
import { Text } from '../ui/text'
import { Ionicons } from '@expo/vector-icons'

import { useT } from '../i18n'
import { askLibraryLive } from '../local/assistant-live'
import type { AssistantResult, Citation, ToolStep } from '../local/assistant'
import { Screen, GUTTER } from '../ui/Screen'
import { Button, IconButton } from '../ui/Button'
import { Divider } from '../ui/Divider'
import { Markdown } from '../components/Markdown'
import { usePalette } from '../ui/palette'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function stepLabel(step: ToolStep, t: ReturnType<typeof useT>): string {
  if (step.name === 'search_library') {
    const q = typeof step.args.query === 'string' ? step.args.query : ''
    return t('ask.step.search', { q, n: step.hits })
  }
  if (step.name === 'read_document') return t('ask.step.read', { title: String(step.args.id ?? '').slice(0, 18) })
  if (step.name === 'list_recent') return t('ask.step.recent', { days: String(step.args.days ?? 7) })
  return t('ask.step.stats')
}

interface Turn {
  question: string
  answer: string
  citations: Citation[]
  steps: ToolStep[]
}

export function AskScreen() {
  const t = useT()
  const router = useRouter()
  const p = usePalette()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ q?: string }>()
  const firstQuestion = typeof params.q === 'string' ? params.q : ''

  const [turns, setTurns] = useState<Turn[]>([])
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<ToolStep[]>([])
  const [streamed, setStreamed] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // What is being asked right now: the first question, or a follow-up typed below.
  const [asking, setAsking] = useState('')
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const startedRef = useRef(false)

  const ask = useCallback(
    async (question: string, history: Turn[]) => {
      const trimmed = question.trim()
      if (!trimmed || running) return
      setAsking(trimmed)
      setRunning(true)
      setError(null)
      setSteps([])
      setStreamed('')
      try {
        const outcome = await askLibraryLive(
          trimmed,
          (step) => {
            // A new round starts clean: whatever streamed before was preamble.
            setStreamed('')
            setSteps((current) => [...current, step])
          },
          (textSoFar) => {
            setStreamed(textSoFar)
            scrollRef.current?.scrollToEnd({ animated: false })
          },
          // Follow-ups carry the earlier turns, so a bare "what about that one"
          // still has a referent.
          history.map((turn) => ({ question: turn.question, answer: turn.answer })),
        )
        appendTurn(trimmed, outcome)
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        setError(t('ask.failed', { reason }))
      } finally {
        setRunning(false)
        setStreamed('')
      }
    },
    [running, t],
  )

  const appendTurn = (question: string, outcome: AssistantResult) => {
    setTurns((current) => [
      ...current,
      { question, answer: outcome.answer, citations: outcome.citations, steps: outcome.steps },
    ])
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
  }

  // The question that opened the screen runs once; a re-render must not re-ask it.
  useEffect(() => {
    if (startedRef.current || !firstQuestion.trim()) return
    startedRef.current = true
    void ask(firstQuestion, [])
  }, [firstQuestion, ask])

  const sendFollowUp = () => {
    const text = draft.trim()
    if (!text || running) return
    setDraft('')
    void ask(text, turns)
  }

  const renderCitations = (citations: Citation[]) => {
    if (citations.length === 0) return null
    return (
      <View className="mt-6">
        <Text className="text-caption tracking-[0.14em] text-faint">{t('ask.citations')}</Text>
        <Divider className="mt-2" />
        {citations.map((item: Citation, index) => (
          <Pressable
            key={item.id}
            onPress={() => router.push(`/documents/${item.id}`)}
            className="border-b border-line py-3"
          >
            <Text className="text-body text-ink" numberOfLines={2}>
              {index + 1}. {item.title ?? item.id}
            </Text>
            <Text className="mt-1 text-caption text-muted">
              {[item.site, item.savedAt].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        ))}
      </View>
    )
  }

  const empty = !firstQuestion.trim() && turns.length === 0

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-[22px] pt-2">
        <IconButton name="chevron-back" onPress={() => router.back()} accessibilityLabel={t('detail.back')} />
        <Text className="text-caption tracking-[0.14em] text-faint">{t('ask.title').toUpperCase()}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {empty ? (
            <View className="mt-8">
              <Text className="text-title font-semibold text-ink">{t('ask.noQuestion')}</Text>
              <Text className="mt-3 text-body-sm text-muted">{t('ask.noQuestionHint')}</Text>
              <View className="mt-6">
                <Button label={t('ask.backHome')} onPress={() => router.replace('/')} size="sm" />
              </View>
            </View>
          ) : null}

          {/* Completed turns, oldest first: the question stays visible so a long
              thread still reads as a conversation rather than one answer. */}
          {turns.map((turn, index) => (
            <View key={`${turn.question}-${index}`} className={index === 0 ? 'mt-5' : 'mt-9'}>
              <Text className="font-serif text-[22px] leading-[30px] text-ink">{turn.question}</Text>
              {turn.steps.length > 0 ? (
                <View className="mt-3">
                  {turn.steps.map((step, i) => (
                    <Text key={`${step.name}-${i}`} className="text-caption text-muted">
                      · {stepLabel(step, t)}
                    </Text>
                  ))}
                </View>
              ) : null}
              <View className="mt-4">
                {turn.answer ? (
                  <Markdown source={turn.answer} />
                ) : (
                  <Text className="text-body text-ink">{t('ask.empty')}</Text>
                )}
              </View>
              {renderCitations(turn.citations)}
            </View>
          ))}

          {/* The turn in flight. */}
          {running ? (
            <View className="mt-9">
              <Text className="font-serif text-[22px] leading-[30px] text-ink">{asking}</Text>
              {steps.length > 0 ? (
                <View className="mt-3">
                  {steps.map((step, i) => (
                    <Text key={`${step.name}-${i}`} className="text-caption text-muted">
                      · {stepLabel(step, t)}
                    </Text>
                  ))}
                </View>
              ) : null}
              {streamed ? (
                <View className="mt-4">
                  <Markdown source={streamed} />
                  <View className="mt-2 flex-row items-center gap-2">
                    <ActivityIndicator size="small" color={p.faint} />
                    <Text className="text-caption text-faint">{t('ask.streaming')}</Text>
                  </View>
                </View>
              ) : (
                <View className="mt-4 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color={p.accent} />
                  <Text className="text-body-sm text-muted">{t('ask.thinking')}</Text>
                </View>
              )}
            </View>
          ) : null}

          {error ? (
            <View className="mt-6">
              <Text className="text-body text-ink">{error}</Text>
              <View className="mt-4 flex-row gap-5">
                <Pressable onPress={() => void ask(asking || firstQuestion, turns)} hitSlop={8}>
                  <Text className="text-body text-accent">{t('ask.retry')}</Text>
                </Pressable>
                <Pressable onPress={() => router.replace('/')} hitSlop={8}>
                  <Text className="text-body text-muted">{t('ask.fallback')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* Follow-up input: the whole point of turning this into a conversation is
            that a second question does not mean going back and starting over. */}
        {turns.length > 0 ? (
          <View
            className="flex-row items-end gap-3 border-t border-line px-[22px] pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('ask.followUp')}
              placeholderTextColor={p.faint}
              selectionColor={p.accent}
              cursorColor={p.accent}
              className="max-h-24 flex-1 text-body text-ink"
              multiline
              onSubmitEditing={sendFollowUp}
              returnKeyType="send"
              accessibilityLabel={t('ask.followUp')}
            />
            <Pressable
              onPress={sendFollowUp}
              disabled={running || !draft.trim()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('ask.send')}
              style={{ opacity: running || !draft.trim() ? 0.4 : 1 }}
            >
              <Ionicons name="arrow-up-circle" size={30} color={p.accent} />
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}
