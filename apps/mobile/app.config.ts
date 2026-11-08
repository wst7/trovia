import type { ExpoConfig } from 'expo/config'

// Production builds must use HTTPS; only development builds may reach LAN HTTP.
const isProduction = process.env.APP_VARIANT === 'production'

// The version follows the release tag: CI injects XUNJI_APP_VERSION when it tags v* (v0.3.1 → 0.3.1).
// Local builds fall back to the default here. Android's versionCode is derived from the version, so upgrades never go backwards.
const rawVersion: string = process.env.XUNJI_APP_VERSION?.trim() || '0.13.9'

/**
 * EAS project id. It is baked into the package for tooling (and would be needed
 * if this project ever went back to EAS builds); it has nothing to do with
 * updates any more — those are switched off below.
 */
const expoProjectId = process.env.EXPO_PROJECT_ID?.trim() ?? ''
/** Account slug: eas-cli needs it to find the project; without it the projectId is ignored. */
const expoOwner = process.env.EXPO_OWNER?.trim() || 'wst7s-team'
const appVersion = rawVersion.replace(/^v/, '')
const [versionMajor = 0, versionMinor = 0, versionPatch = 0] = appVersion
  .split('.')
  .map((part) => Number.parseInt(part, 10) || 0)
const versionCode = versionMajor * 10000 + versionMinor * 100 + versionPatch

// Keep in sync with surface in src/design/colorSchemes.ts so the native animation and launch screen don't flash white or black.
// Paper (stamp-album world): light coated paper / dark deep-green album cloth.
const LIGHT_SURFACE = '#F3EDE0'
const DARK_SURFACE = '#1C2422'

const config: ExpoConfig = {
  name: 'Trovia',
  slug: 'trovia',
  version: appVersion,
  scheme: 'trovia',
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: LIGHT_SURFACE,
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.trovia.app',
    buildNumber: String(versionCode),
    infoPlist: {
      NSLocalNetworkUsageDescription: 'Trovia 会直接读取你保存的链接，也可能连接你自己配置的大模型服务。',
      ...(isProduction
        ? {}
        : {
            NSAppTransportSecurity: {
              NSAllowsArbitraryLoads: true,
            },
          }),
    },
  },
  // No OTA. There are no update channels to configure, keep in sync, or
  // publish per release: a new build is a new APK someone installs. Keeping the
  // block present and disabled means expo-updates ignores any bundle a previous
  // build may have downloaded.
  updates: {
    enabled: false,
  },
  // Inert while `updates.enabled` is false, and kept only so the value does not
  // silently change if updates are ever turned back on.
  runtimeVersion: 'native-1',
  extra: {
    ...(expoProjectId ? { eas: { projectId: expoProjectId } } : {}),
  },
  owner: expoProjectId ? expoOwner : undefined,
  android: {
    package: 'com.trovia.app',
    versionCode,
    // In-app update: hand the downloaded apk to the system installer (the user still taps "Install" in the system UI).
    permissions: ['REQUEST_INSTALL_PACKAGES'],
    predictiveBackGestureEnabled: false,
    adaptiveIcon: {
      backgroundColor: '#F3EDE0',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    // Bundle the body font: Android ships no Chinese serif, so a 2.3MB subset goes with the app.
    [
      'expo-media-library',
      {
        // Used only to write into the photo library: it never reads the user's photos and asks for no location.
        photosPermission: 'Trovia 需要访问相册，才能把正文里的图片保存下来。',
        savePhotosPermission: 'Trovia 把正文图片存到你的相册。',
        // Only the "write images to the photo library" permission, no music/video — a prompt asking for "music and audio"
        // makes users wonder what this app is really up to.
        granularPermissions: ['photo'],
        isAccessMediaLocationEnabled: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: LIGHT_SURFACE,
        image: './assets/splash-icon.png',
        imageWidth: 160,
        dark: {
          backgroundColor: DARK_SURFACE,
          image: './assets/splash-icon.png',
        },
      },
    ],
    'expo-secure-store',
    [
      'expo-share-intent',
      {
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
        },
        androidIntentFilters: ['text/*'],
      },
    ],
    // Native build settings are configured here (android/ is a prebuild artifact and is not committed).
    [
      'expo-build-properties',
      {
        android: {
          // Only development builds allow cleartext HTTP: the app fetches web pages directly.
          usesCleartextTraffic: !isProduction,
          // R8 is on for release; ML Kit initializes via reflection, so it must be kept explicitly, otherwise OCR throws
          // an NPE when constructing InputImage (java.lang.Object.getClass() on a null object reference).
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          extraProguardRules: [
            '-keep class com.google.mlkit.** { *; }',
            '-keep class com.google.android.gms.internal.mlkit_vision_text** { *; }',
            '-keep class com.google.android.gms.internal.mlkit_vision_common** { *; }',
            '-dontwarn com.google.mlkit.**',
            '-dontwarn com.google.android.gms.internal.mlkit_vision_text**',
          ].join('\n'),
        },
      },
    ] as [string, Record<string, unknown>],
  ],
}

export default config
