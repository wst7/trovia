import { Platform } from 'react-native'

/**
 * Image text recognition (OCR).
 *
 * Uses ML Kit's on-device Chinese recognition model: no network, no image uploads, and results go only into the local database.
 *
 * Images must first be written to a local file before being handed to ML Kit: passing an http URL directly fails on Android.
 * And the various image hosts (sspai, WeChat public accounts, juejin) commonly return 403 for requests without a Referer,
 * so downloads carry a browser-like UA + Referer; if that still fails, fall back to fetch + base64 written to disk.
 *
 * This module never throws: an image that cannot be recognised is treated as "this image has no text", because one image must not
 * turn the whole saved item into a failure.
 */

type TextRecognitionModule = {
  recognize: (
    url: string,
    script?: string,
  ) => Promise<{ text?: string; blocks?: { text?: string }[] }>
}

type TextRecognitionExports = {
  module: TextRecognitionModule
  /** This package puts recognize on default and the script enum on the named export. */
  scripts: Record<string, string>
}

type FileSystemModule = typeof import('expo-file-system/legacy')

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

let cached: TextRecognitionExports | null | undefined

function loadModule(): TextRecognitionExports | null {
  if (cached !== undefined) return cached
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-ml-kit/text-recognition')
    const module = (mod?.default ?? mod) as TextRecognitionModule
    // The enum may sit on default or be a named export (depending on how the package is bundled).
    const fromDefault = (module as unknown as Record<string, unknown>)?.TextRecognitionScript
    const scripts = ((mod?.TextRecognitionScript ?? fromDefault) || {}) as Record<string, string>
    cached = module ? { module, scripts } : null
  } catch {
    cached = null
  }
  return cached
}

function fileSystem(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

export function isOcrAvailable(): boolean {
  return loadModule() !== null && fileSystem() !== null
}

/** Download one image: try the native download first (with request headers), then fall back to fetch + base64 written to disk. */
async function fetchImage(url: string, referer: string): Promise<string | null> {
  const fs = fileSystem()
  if (!fs) return null
  const target = `${fs.cacheDirectory}ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.img`
  const headers = { 'User-Agent': UA, Referer: referer, Accept: 'image/*,*/*;q=0.8' }

  try {
    const result = await fs.downloadAsync(url, target, { headers })
    if (result.status === 200) return result.uri
  } catch {
    // Falls through to the fetch fallback below.
  }

  try {
    const res = await fetch(url, { headers })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    const base64 = globalThis.btoa(binary)
    await fs.writeAsStringAsync(target, base64, { encoding: 'base64' })
    return target
  } catch {
    return null
  }
}

async function recognizeOne(url: string, referer: string): Promise<string> {
  const loaded = loadModule()
  const fs = fileSystem()
  if (!loaded || !fs) return ''
  const local = await fetchImage(url, referer)
  if (!local) return ''

  try {
    const script = loaded.scripts.CHINESE ?? 'Chinese'
    const result = await loaded.module.recognize(local, script)
    const text = (result.text ?? '').trim()
    // Recognition noise: too few characters, or almost no Chinese characters / alphanumerics.
    if (text.length < 12) return ''
    const meaningful = (text.match(/[\u4e00-\u9fa5A-Za-z0-9]/g) ?? []).length
    if (meaningful < text.length * 0.3) return ''
    return text
  } catch {
    return ''
  } finally {
    void fs.deleteAsync(local, { idempotent: true }).catch(() => undefined)
  }
}

/**
 * Batch recognition. Three images at most by default — one long image often holds thousands of characters, so more would be slow and pointless.
 * Pass the original article URL as referer: image hosts generally use it to decide whether the request came from a page.
 */
/** At most this many images are read per parse: the decorative images in a body never exceed this count. */
export const MAX_OCR_IMAGES = 24
/** Total time budget for one OCR round: however many images there are, the local queue must not get stuck here. */
const OCR_BUDGET_MS = 45_000

/**
 * Batch-recognise **all** images. One at a time, serially (ML Kit is not good at concurrency),
 * bounded only by two limits: 24 images in total, and a 45-second budget per round —
 * images that run past the deadline are skipped, and text already read is still stored as usual.
 */
export async function ocrImages(urls: string[], referer: string): Promise<string[]> {
  if (Platform.OS === 'web' || !isOcrAvailable()) return []
  const deadline = Date.now() + OCR_BUDGET_MS
  const results: string[] = []
  for (const url of urls.slice(0, MAX_OCR_IMAGES)) {
    if (Date.now() > deadline) break
    const text = await recognizeOne(url, referer)
    if (text) results.push(text)
  }
  return results
}
