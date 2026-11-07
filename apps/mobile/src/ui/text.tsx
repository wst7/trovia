/**
 * 全 app 的 Text：统一在这里出口，但不再指定字族。
 *
 * 之前为了「纸面阅读」自带了一份思源宋体，问题是它的字面比系统字体大一号，
 * 固定行高的地方会被撑破、压到相邻元素上。现在全部改用手机默认字体：
 * 中文在 Android 上是 Noto Sans CJK，在 iOS 上是苹方，系统会自己处理
 * 字重和行高，界面不再和布局算法对着干。
 */
import { Text as RNText, type TextProps } from 'react-native'

export function Text(props: TextProps) {
  return <RNText {...props} />
}
