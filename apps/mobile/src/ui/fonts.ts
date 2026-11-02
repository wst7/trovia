import { Platform } from 'react-native'

/**
 * 衬线只用在标题上（首页大标题、详情页标题、详情页里的引用）。
 *
 * Android 的 `serif` 会落到 Noto Serif CJK，中文有真正的顿笔；iOS 上 'serif' 不是
 * 合法家族名，会静默退回系统无衬线，所以显式给 Georgia（它对拉丁文是衬线，
 * 中文仍回退到苹方——可接受，因为 iOS 端本来就没法在这里验证）。
 */
export const serifFamily = Platform.select({
  android: 'serif',
  ios: 'Georgia',
  default: 'serif',
})
