/**
 * 全 app 的 Text：默认字体在这里定，不在每个屏幕里各写一遍。
 *
 * 分工只有两条：
 *   界面（导航、按钮、列表、设置、表单）→ 黑体
 *   阅读（正文、标题、摘要）→ 宋体，由 Markdown 和详情页显式覆盖
 *
 * 包一层的原因是 RN 没有全局默认字体，OEM 系统各自换掉 sans 之后，
 * 同一个界面在不同机器上字重和字宽都不一样；这里显式点名，至少
 * Android 上不会跟着厂商皮肤走。
 */
import { Text as RNText, type TextProps } from 'react-native'

import { APP_FAMILY } from './fonts'

export function Text({ style, ...rest }: TextProps) {
  return <RNText {...rest} style={[{ fontFamily: APP_FAMILY }, style]} />
}
