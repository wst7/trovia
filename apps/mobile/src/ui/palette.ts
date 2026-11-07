import { useColorScheme } from 'react-native'

/**
 * The single entry point for imperative colour lookups: Ionicons' color, placeholderTextColor,
 * RefreshControl and similar props do not accept className, only a string.
 *
 * The values map one-to-one onto the CSS variables in `global.css`; changing one means changing the other.
 */
export const palette = {
  light: {
    canvas: '#f6f5f1',
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
    canvas: '#10100f',
    surface: '#1b1b19',
    sunken: '#0c0c0b',
    line: '#2b2b28',
    lineStrong: '#3b3b37',
    ink: '#edeae4',
    muted: '#9b9891',
    faint: '#8a877f',
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
