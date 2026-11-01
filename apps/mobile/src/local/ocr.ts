import { Platform } from 'react-native'

/**
 * 图片文字识别（OCR）。
 *
 * 用 ML Kit 的端侧中文识别模型：不联网、不上传图片，识别结果只进本机数据库。
 *
 * 图片要先落到本地文件再交给 ML Kit：直接用 http 地址在 Android 上会失败。
 * 而各家图床（少数派、公众号、掘金）普遍对不带 Referer 的请求返回 403，
 * 所以下载时按浏览器的方式带上 UA + Referer；还不行就退回 fetch + base64 落盘。
 *
 * 这个模块永远不抛错：识别不出来就当「这张图没有文字」，不能因为一张图
 * 让整条收藏变成失败。
 */

type TextRecognitionModule = {
  recognize: (
    url: string,
    script?: string,
  ) => Promise<{ text?: string; blocks?: { text?: string }[] }>
}

type TextRecognitionExports = {
  module: TextRecognitionModule
  /** 这个包把 recognize 放在 default 上，把 script 枚举放在具名导出里。 */
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
    // 枚举可能在 default 上，也可能是具名导出（取决于打包方式）。
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

/** 下载一张图；先走原生下载（带请求头），失败再走 fetch + base64 落盘。 */
async function fetchImage(url: string, referer: string): Promise<string | null> {
  const fs = fileSystem()
  if (!fs) return null
  const target = `${fs.cacheDirectory}ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.img`
  const headers = { 'User-Agent': UA, Referer: referer, Accept: 'image/*,*/*;q=0.8' }

  try {
    const result = await fs.downloadAsync(url, target, { headers })
    if (result.status === 200) return result.uri
  } catch {
    // 落到下面的 fetch 兜底。
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
    // 识别噪声：字符太少，或几乎没有汉字/字母数字。
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
 * 批量识别。默认最多 3 张——一张长图往往就是几千字，再多既慢又没必要。
 * referer 传原文地址：图床普遍按它判断「是不是从页面里点进来的」。
 */
/** 一次解析最多读这么多张图：正文里的装饰图不会超过这个数量。 */
export const MAX_OCR_IMAGES = 24
/** 一轮 OCR 的总时间预算：图再多也不能把本机队列卡在这里。 */
const OCR_BUDGET_MS = 45_000

/**
 * 批量识别**所有**图片。逐张串行（ML Kit 不擅长并发），
 * 只受两个上限约束：图片总数 24 张，以及整轮 45 秒预算——
 * 超时的图片就跳过，已经读到的文字照常入库。
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
