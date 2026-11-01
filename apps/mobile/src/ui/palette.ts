import { useColorScheme } from 'react-native'

/**
 * 命令式取色的唯一入口：Ionicons 的 color、placeholderTextColor、
 * RefreshControl 这些 prop 不接受 className，只能给字符串。
 *
 * 值与 `global.css` 的 CSS 变量一一对应，改一处必须同时改另一处。
 */
export const palette = {
  light: {
    canvas: '#fbfaf7',
    surface: '#ffffff',
    sunken: '#f4f3ef',
    line: '#e8e6e1',
    lineStrong: '#d6d3cc',
    ink: '#1a1917',
    muted: '#6e6c67',
    faint: '#a3a099',
    accent: '#b23a26',
    accentQuiet: '#f7eae6',
    danger: '#b3352b',
    warn: '#8a5a20',
    ok: '#2f6b47',
    onAccent: '#ffffff',
  },
  dark: {
    canvas: '#121211',
    surface: '#1b1b19',
    sunken: '#0c0c0b',
    line: '#2b2b28',
    lineStrong: '#3b3b37',
    ink: '#edeae4',
    muted: '#9b9891',
    faint: '#6b6862',
    accent: '#e4715b',
    accentQuiet: '#2e1d18',
    danger: '#e4685c',
    warn: '#d9a15b',
    ok: '#6fbe8e',
    onAccent: '#121211',
  },
} as const

export type Palette = {
  [K in keyof (typeof palette)['light']]: string
}

export function usePalette(): Palette {
  const scheme = useColorScheme()
  return scheme === 'dark' ? palette.dark : palette.light
}
