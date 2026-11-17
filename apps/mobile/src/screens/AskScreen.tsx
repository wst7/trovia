/**
 * "Ask the model" screen: a short conversation over the local library.
 *
 * v3 turns the screen into three pieces: the question in a filled bubble, the tool
 * process compressed into one factual line, and the answer in a white card. Sources
 * keep their covers so the user can recognise the article before opening it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import { Ionicons } from '@expo/vector-icons'

import { useT } from '../i18n'
import { formatRelativeDate } from '@trovia/shared'
import { askLibraryLive } from '../local/assistant-live'
import type { AssistantResult, Citation, ToolStep } from '../local/assistant'
import { Screen, GUTTER } from '../ui/Screen'
import { Markdown } from '../components/Markdown'
import { tileFor, useIsDark, usePalette } from '../ui/palette'
import { useTapGuard } from '../hooks/useTapGuard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeepAboveKeyboard } from '../ui/use-keep-above-keyboard'

function stepLabel(step: ToolStep, t: ReturnType<typeof useT>): string {
  if (step.name === 'search_library') {
    const q = typeof step.args.query === 'string' ? step.args.query : ''
    return t('ask.step.search', { q, n: step.hits })
  }
  if (step.name === 'read_document') {
    return step.subject ? t('ask.step.read', { title: step.subject }) : t('ask.step.readUntitled')
  }
  if (step.name === 'list_recent') return t('ask.step.recent', { days: String(step.args.days ?? 7) })
  return t('ask.step.stats')
}

/** One line of evidence, not a log: how many articles were read and how many hits the searches returned. */
function traceText(steps: ToolStep[], t: ReturnType<typeof useT>): string {
  const reads = steps.filter((step) => step.name === 'read_document').length
  const hits = steps
    .filter((step) => step.name === 'search_library')
    .reduce((sum, step) => sum + (Number.isFinite(step.hits) ? step.hits : 0), 0)
  if (reads > 0 || hits > 0) return t('ask.trace', { read: reads, hits })
  const last = steps[steps.length - 1]
  return last ? stepLabel(last, t) : ''
}

interface Turn {
  question: string
  answer: string
  citations: Citation[]
  steps: ToolStep[]
}

function CitationRow({ item, last, onOpen }: { item: Citation; last: boolean; onOpen: (id: string) => void }) {
  const tap = useTapGuard()
  const p = usePalette()
  const dark = useIsDark()
  const seed = item.site ?? item.title ?? item.id
  const initial = seed.replace(/^www\./, '').slice(0, 1).toUpperCase() || '·'
  return (
    <Pressable
      onPressIn={tap.onPressIn}
      onPress={(event) => {
        if (tap.shouldPress(event)) onOpen(item.id)
      }}
      onLongPress={() => tap.markLongPress()}
      delayLongPress={320}
      accessibilityRole="button"
      className={last ? 'flex-row items-center gap-3 py-[11px]' : 'flex-row items-center gap-3 border-t border-line py-[11px]'}
    >
      <View
        className="h-12 w-[38px] items-center justify-center rounded-[8px]"
        style={{ backgroundColor: tileFor(seed, dark) }}
      >
        <Text className="text-[15px] font-semibold text-white opacity-90">{initial}</Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-[14px] font-semibold leading-[20px] tracking-[-0.14px] text-ink"
          numberOfLines={2}
        >
          {item.title ?? item.id}
        </Text>
        <Text className="mt-[3px] text-[11.5px] text-faint" numberOfLines={1}>
          {[item.site, item.savedAt ? formatRelativeDate(item.savedAt) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={p.lineStrong} />
    </Pressable>
  )
}

export function AskScreen() {
  const t = useT()
  const router = useRouter()
  const p = usePalette()
  const insets = useSafeAreaInsets()
  // The pinned input has to sit exactly on top of the keyboard. KeyboardAvoidingView
  // resizes the area but the reported height is not what the bar needs on Android,
  // which left the input half covered; the measured height is.
  const { keyboardHeight } = useKeepAboveKeyboard()
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
  const abortRef = useRef<AbortController | null>(null)
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
      const controller = new AbortController()
      abortRef.current = controller
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
          history.map((turn) => ({
            question: turn.question,
            answer: turn.answer,
            citations: turn.citations,
          })),
          controller.signal,
        )
        if (controller.signal.aborted) {
          setError(t('ask.stopped'))
        } else {
          appendTurn(trimmed, outcome)
        }
      } catch (e) {
        if (controller.signal.aborted) {
          setError(t('ask.stopped'))
        } else {
          const reason = e instanceof Error ? e.message : String(e)
          setError(t('ask.failed', { reason }))
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setRunning(false)
        setStreamed('')
      }
    },
    [running, t],
  )

  const stop = () => abortRef.current?.abort()

  useEffect(() => () => abortRef.current?.abort(), [])

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

  const send = () => {
    const text = draft.trim()
    if (!text || running) return
    setDraft('')
    void ask(text, turns)
  }

  const renderCitations = (citations: Citation[]) => {
    if (citations.length === 0) return null
    return (
      <View className="mt-3.5">
        <Text className="text-label uppercase text-faint">{t('ask.citations')}</Text>
        {citations.map((item, index) => (
          <CitationRow
            key={item.id}
            item={item}
            last={index === citations.length - 1}
            onOpen={(id) => router.push(`/documents/${id}`)}
          />
        ))}
      </View>
    )
  }

  const empty = !firstQuestion.trim() && turns.length === 0 && !running && !error

  return (
    <Screen>
      <View className="h-[52px] flex-row items-center justify-between px-5">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel={t('detail.back')}
          className="flex-row items-center gap-2"
        >
          <Ionicons name="chevron-back" size={20} color={p.ink} />
          <Text className="text-[17px] font-semibold tracking-[-0.34px] text-ink">
            {t('ask.title')}
          </Text>
        </Pressable>
        <Text className="text-[13px] text-faint">{t('ask.readonly')}</Text>
      </View>

      <View className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 148 }}
          keyboardShouldPersistTaps="handled"
        >
          {empty ? (
            <View className="mt-6">
              <Text className="text-[26px] font-semibold leading-[35px] tracking-[-0.57px] text-ink">
                {t('ask.noQuestion')}
              </Text>
              <Text className="mt-2.5 text-[14.5px] leading-[23px] text-muted">
                {t('ask.noQuestionHint')}
              </Text>
            </View>
          ) : null}

          {/* Completed turns, oldest first: the question stays visible so a long
              thread still reads as a conversation rather than one answer. */}
          {turns.map((turn, index) => (
            <View key={`${turn.question}-${index}`} className={index === 0 ? 'mt-2' : 'mt-8'}>
              <View className="rounded-[16px] rounded-bl-[6px] bg-sunken px-4 py-3.5">
                <Text className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.92px] text-faint">
                  {t('ask.youAsked')}
                </Text>
                <Text className="text-body leading-[26px] tracking-[-0.16px] text-ink">
                  {turn.question}
                </Text>
              </View>

              {turn.steps.length > 0 ? (
                <View className="mx-0.5 mt-4 flex-row items-center gap-[9px]">
                  <Ionicons name="checkmark" size={14} color={p.ok} />
                  <Text className="text-[12.5px] text-faint">{traceText(turn.steps, t)}</Text>
                </View>
              ) : null}

              <View className="mt-4 rounded-[16px] border border-line bg-surface px-4 pb-1.5 pt-4">
                <View className="mb-2.5 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <View className="h-5 w-5 items-center justify-center rounded-[6px] bg-accent">
                      <Ionicons name="sparkles" size={12} color={p.onAccent} />
                    </View>
                    <Text className="text-[13px] font-semibold text-ink">{t('ask.answer')}</Text>
                  </View>
                </View>
                {turn.answer ? (
                  <Markdown source={turn.answer} compact />
                ) : (
                  <Text className="pb-3 text-body-sm text-ink">{t('ask.empty')}</Text>
                )}
              </View>

              {renderCitations(turn.citations)}
            </View>
          ))}

          {/* The turn in flight. */}
          {running ? (
            <View className="mt-8">
              <View className="rounded-[16px] rounded-bl-[6px] bg-sunken px-4 py-3.5">
                <Text className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.92px] text-faint">
                  {t('ask.youAsked')}
                </Text>
                <Text className="text-body leading-[26px] tracking-[-0.16px] text-ink">{asking}</Text>
              </View>

              <View className="mx-0.5 mt-4 flex-row items-center gap-[9px]">
                {steps.length > 0 ? (
                  <Ionicons name="checkmark" size={14} color={p.ok} />
                ) : (
                  <ActivityIndicator size="small" color={p.faint} />
                )}
                <Text className="text-[12.5px] text-faint">
                  {steps.length > 0 ? traceText(steps, t) : t('ask.thinking')}
                </Text>
              </View>

              <View className="mt-4 rounded-[16px] border border-line bg-surface px-4 pb-1.5 pt-4">
                <View className="mb-2.5 flex-row items-center gap-2">
                  <View className="h-5 w-5 items-center justify-center rounded-[6px] bg-accent">
                    <Ionicons name="sparkles" size={12} color={p.onAccent} />
                  </View>
                  <Text className="text-[13px] font-semibold text-ink">{t('ask.answer')}</Text>
                </View>
                {streamed ? (
                  <>
                    <Markdown source={streamed} compact />
                    <View className="mb-3 flex-row items-center gap-2">
                      <ActivityIndicator size="small" color={p.faint} />
                      <Text className="text-[12px] text-faint">{t('ask.streaming')}</Text>
                    </View>
                  </>
                ) : (
                  <View className="flex-row items-center gap-2 pb-4">
                    <ActivityIndicator size="small" color={p.accent} />
                    <Text className="text-[14px] text-muted">{t('ask.thinking')}</Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}

          {error ? (
            <View className="mt-5 rounded-[16px] border border-line bg-surface px-4 py-4">
              <Text className="text-[14px] leading-[22px] text-ink">{error}</Text>
              <View className="mt-3 flex-row gap-5">
                <Pressable onPress={() => void ask(asking || firstQuestion, turns)} hitSlop={8}>
                  <Text className="text-[14px] text-accent">{t('ask.retry')}</Text>
                </Pressable>
                <Pressable onPress={() => router.replace('/')} hitSlop={8}>
                  <Text className="text-[14px] text-faint">{t('ask.fallback')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* One dock for the first question and every follow-up: v3 keeps it pinned,
            with the same 50dp box as the home search field. */}
        <View
          className="border-t border-line bg-canvas px-5 pt-2.5"
          style={{ paddingBottom: (keyboardHeight > 0 ? keyboardHeight + 24 : insets.bottom) + 12 }}
        >
          <View className="h-[50px] flex-row items-center gap-2.5 rounded-[14px] border border-line bg-surface pl-3.5 pr-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('ask.placeholder')}
              placeholderTextColor={p.faint}
              selectionColor={p.accent}
              cursorColor={p.accent}
              className="h-[48px] flex-1 py-0 text-[14px] text-ink"
              multiline={false}
              onSubmitEditing={send}
              returnKeyType="send"
              accessibilityLabel={t('ask.placeholder')}
            />
            {draft.length > 0 ? (
              <Pressable
                onPress={() => setDraft('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('ask.clear')}
                className="h-6 w-6 items-center justify-center rounded-full bg-sunken"
              >
                <Ionicons name="close" size={13} color={p.muted} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={running ? stop : send}
              disabled={!running && !draft.trim()}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={running ? t('ask.stop') : t('ask.send')}
              accessibilityState={{ disabled: !running && !draft.trim() }}
              className={
                running
                  ? 'h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-ink'
                  : draft.trim()
                    ? 'h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-accent'
                    : 'h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-sunken'
              }
            >
              <Ionicons
                name={running ? 'stop' : 'arrow-up'}
                size={16}
                color={running ? p.canvas : draft.trim() ? p.onAccent : p.faint}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Screen>
  )
}
