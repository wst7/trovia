/**
 * The app's own version number.
 *
 * It must read the **native** version: after a hot update, `expoConfig.version` in JS comes from that update's manifest,
 * and updates are built from main, so the version in the manifest can be older than the installed APK — users end up seeing
 * "0.13.2 is installed but the UI shows 0.12.2". The native version only changes on reinstall; that is a fact.
 */
export async function appVersion(): Promise<string> {
  try {
    const Application = await import('expo-application')
    const native = Application.nativeApplicationVersion
    if (native) return native
  } catch {
    // Older builds have no expo-application: fall back to the version in the JS manifest.
  }
  try {
    const Constants = await import('expo-constants')
    return Constants.default.expoConfig?.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
