/**
 * 把「问模型」接上真实的大模型与真实工具。
 *
 * 单独一层的原因：assistant.ts 要能在 node 里直接跑测试，
 * 不能因为 import 了 expo-secure-store 就依赖原生模块。
 */
import { chatStep, isLocalEndpoint, loadLlmKey, loadLlmState } from './llm'
import { runTool, toolSchemas } from './assistant-tools'
import { askLibrary } from './assistant'
import type { AssistantResult, ToolStep } from './assistant'

export async function askLibraryLive(
  question: string,
  onStep?: (step: ToolStep) => void,
): Promise<AssistantResult> {
  const state = await loadLlmState()
  if (!state.enabled) throw new Error('设置里还没打开大模型')
  const key = await loadLlmKey()
  if (!key && !isLocalEndpoint(state.baseUrl)) throw new Error('还没有填 API Key')

  return askLibrary(question, {
    onStep,
    run: runTool,
    step: (messages) => chatStep(state, key ?? '', messages, toolSchemas(), 900),
  })
}
