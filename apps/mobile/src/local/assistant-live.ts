/**
 * Wire "ask the model" up to a real LLM and real tools.
 *
 * Why it is a separate layer: assistant.ts has to run directly under node in tests,
 * and it must not depend on native modules just because it imports expo-secure-store.
 */
import { chatStep, chatStepStream, isLocalEndpoint, loadLlmKey, loadLlmState } from './llm'
import { runTool, toolSchemas } from './assistant-tools'
import { askLibrary } from './assistant'
import type { AssistantResult, ToolStep } from './assistant'

export async function askLibraryLive(
  question: string,
  onStep?: (step: ToolStep) => void,
  onAnswer?: (textSoFar: string) => void,
  history?: { question: string; answer: string }[],
): Promise<AssistantResult> {
  const state = await loadLlmState()
  if (!state.enabled) throw new Error('设置里还没打开大模型')
  const key = await loadLlmKey()
  if (!key && !isLocalEndpoint(state.baseUrl)) throw new Error('还没有填 API Key')

  return askLibrary(question, {
    history,
    onStep,
    onAnswerDelta: onAnswer,
    run: runTool,
    // Stream only when the screen is listening: the pipeline calls the same
    // helpers without a UI and has no reason to pay for the event stream.
    step: (messages, onDelta) =>
      onDelta
        ? chatStepStream(state, key ?? '', messages, toolSchemas(), 900, onDelta)
        : chatStep(state, key ?? '', messages, toolSchemas(), 900),
  })
}
