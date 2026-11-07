/**
 * App 自己的版本号。
 *
 * 必须读**原生**版本：热更新后 JS 里的 `expoConfig.version` 来自那条更新清单，
 * 而更新是从 main 打的，清单里的版本可能比装着的 APK 旧——用户会看到
 * 「装的是 0.13.2，界面显示 0.12.2」。原生版本只有重装才会变，这是事实。
 */
export async function appVersion(): Promise<string> {
  try {
    const Application = await import('expo-application')
    const native = Application.nativeApplicationVersion
    if (native) return native
  } catch {
    // 老包里没有 expo-application：退回到 JS 清单里的版本。
  }
  try {
    const Constants = await import('expo-constants')
    return Constants.default.expoConfig?.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
