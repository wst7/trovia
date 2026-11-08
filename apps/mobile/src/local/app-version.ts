/**
 * The app's own version number.
 *
 * It must read the **native** version, not the one in the JS manifest: the two
 * can disagree (a package installed by hand, or a build whose manifest was
 * generated earlier than the APK), and the user in front of the phone can only
 * tell us what they installed. `expoConfig.version` is a fallback for the rare
 * runtime where `expo-application` is missing.
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
