import type { ExpoConfig } from 'expo/config'

// 生产构建必须使用 HTTPS；开发构建才允许访问局域网 HTTP。
const isProduction = process.env.APP_VARIANT === 'production'

// 版本号跟发布 tag 走：CI 打 v* 标签时注入 XUNJI_APP_VERSION（v0.3.1 → 0.3.1）。
// 本地构建回退到这里的默认值。Android 的 versionCode 由版本号推导，升级安装不会退版。
const rawVersion: string = process.env.XUNJI_APP_VERSION ?? '0.11.1'
const appVersion = rawVersion.replace(/^v/, '')
const [versionMajor = 0, versionMinor = 0, versionPatch = 0] = appVersion
  .split('.')
  .map((part) => Number.parseInt(part, 10) || 0)
const versionCode = versionMajor * 10000 + versionMinor * 100 + versionPatch

// 与 src/design/colorSchemes.ts 的 surface 保持一致，避免原生动画/启动时闪白或闪黑。
// 纸面（集邮册世界）：light 胶面纸 / dark 深绿集邮册布。
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
  android: {
    package: 'com.trovia.app',
    versionCode,
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
    [
      'expo-media-library',
      {
        // 只用来往相册里写：不读用户的照片，也不要位置信息。
        photosPermission: 'Trovia 需要访问相册，才能把正文里的图片保存下来。',
        savePhotosPermission: 'Trovia 把正文图片存到你的相册。',
        // 只要「往相册写图片」这一项，不要音乐/视频权限——弹窗问「访问音乐和音频」
        // 会让用户怀疑这个 App 要干什么。
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
    // 原生构建参数统一在这里配置（android/ 是 prebuild 产物，不提交）。
    [
      'expo-build-properties',
      {
        android: {
          // 只有开发构建允许明文 HTTP：App 会直接抓网页。
          usesCleartextTraffic: !isProduction,
          // release 开 R8；ML Kit 的初始化走反射，必须显式保活，否则 OCR 会在
          // InputImage 构造时抛 NPE（java.lang.Object.getClass() on a null object reference）。
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
