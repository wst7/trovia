/**
 * 热更新（expo-updates）的薄封装。
 *
 * 只做三件事：看现在跑的是内嵌包还是热更新、查有没有新的、下载并重启。
 * 没有配置 EAS 项目时（本地构建的包）整块安静地关掉，不打扰用户。
 */
let updatesModule: typeof import('expo-updates') | null = null

async function updates(): Promise<typeof import('expo-updates') | null> {
  if (updatesModule) return updatesModule
  try {
    updatesModule = await import('expo-updates')
    return updatesModule
  } catch {
    return null
  }
}

export interface OtaState {
  /** 这个包装了热更新能力没有。 */
  enabled: boolean
  /** 当前是否跑在一次热更新上（false = 内嵌包）。 */
  runningUpdate: boolean
  /** 当前这次更新的 id 前 6 位，方便对日志。 */
  updateId: string | null
  /** 这次更新是何时发布的（ISO）。 */
  createdAt: string | null
}

export async function readOtaState(): Promise<OtaState> {
  const expo = await updates()
  if (!expo?.isEnabled) {
    return { enabled: false, runningUpdate: false, updateId: null, createdAt: null }
  }
  const id = typeof expo.updateId === 'string' ? expo.updateId : null
  return {
    enabled: true,
    runningUpdate: expo.isEmbeddedLaunch === false,
    updateId: id ? id.slice(0, 6) : null,
    createdAt: expo.createdAt ? expo.createdAt.toISOString() : null,
  }
}

export type OtaOutcome =
  | { kind: 'unavailable' }
  | { kind: 'latest' }
  | { kind: 'downloaded'; id: string | null }

/** 查 + 下；下好了要调用方决定何时重启（reload）。 */
export async function checkOta(): Promise<OtaOutcome> {
  const expo = await updates()
  if (!expo?.isEnabled) return { kind: 'unavailable' }
  const check = await expo.checkForUpdateAsync()
  if (!check.isAvailable) return { kind: 'latest' }
  const fetched = await expo.fetchUpdateAsync()
  return { kind: 'downloaded', id: fetched.manifest?.id?.slice(0, 6) ?? null }
}

/** 重启到新包。 */
export async function applyOta(): Promise<void> {
  const expo = await updates()
  if (!expo?.isEnabled) throw new Error('这个包没有开启热更新')
  await expo.reloadAsync()
}
