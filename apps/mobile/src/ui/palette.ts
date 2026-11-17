import { useColorScheme } from 'react-native'

/**
 * The single entry point for imperative colour lookups: Ionicons' color, placeholderTextColor,
 * RefreshControl and similar props do not accept className, only a string.
 *
 * The values map one-to-one onto the CSS variables in `global.css`; changing one means changing the other.
 */
export const palette = {
  light: {
    canvas: '#fafaf7',
    surface: '#ffffff',
    sunken: '#f2f1eb',
    line: '#e4e2d9',
    lineStrong: '#d2cfc4',
    ink: '#14130f',
    muted: '#56524a',
    faint: '#6f6a60',
    accent: '#c1371c',
    accentQuiet: '#fcede7',
    danger: '#b3261e',
    warn: '#8a5a20',
    ok: '#1f6b45',
    onAccent: '#ffffff',
  },
  dark: {
    canvas: '#0d0c0a',
    surface: '#171614',
    sunken: '#201f1b',
    line: '#2c2a25',
    lineStrong: '#3c3931',
    ink: '#f6f2e9',
    muted: '#b7b2a6',
    faint: '#9a9488',
    accent: '#ff6c4c',
    accentQuiet: '#2b1913',
    danger: '#f07362',
    warn: '#d8a35f',
    ok: '#63b98a',
    onAccent: '#171006',
  },
} as const

/** Six quiet cover tints from v3; used when an article has no image. */
const TILE_LIGHT = ['#2f4858', '#4f5b45', '#8e4a33', '#23211c', '#6b6459', '#a8785a']
const TILE_DARK = ['#334b5c', '#525d47', '#8f4b34', '#1c1a16', '#5f594e', '#9d7053']

export function tileFor(seed: string, dark: boolean): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return (dark ? TILE_DARK : TILE_LIGHT)[Math.abs(hash) % 6]
}

export type Palette = {
  [K in keyof (typeof palette)['light']]: string
}

export function usePalette(): Palette {
  const scheme = useColorScheme()
  return scheme === 'dark' ? palette.dark : palette.light
}

/** True when the effective theme is dark. Used where a colour alone cannot express the change (images). */
export function useIsDark(): boolean {
  return useColorScheme() === 'dark'
}
