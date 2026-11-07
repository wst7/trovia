/**
 * The app-wide Text: a single outlet here, but it no longer specifies a font family.
 *
 * It used to bundle Source Han Serif for "paper-like reading", but its face is one size larger than the system font,
 * so places with fixed line height broke open and pressed into neighboring elements. Now everything uses the phone's default font:
 * Chinese is Noto Sans CJK on Android and PingFang on iOS, and the system handles weight and line height itself,
 * so the UI no longer fights the layout algorithm.
 */
import { Text as RNText, type TextProps } from 'react-native'

export function Text(props: TextProps) {
  return <RNText {...props} />
}
