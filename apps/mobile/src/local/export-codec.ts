/**
 * 备份编解码。
 *
 * 导出的是 .zip：里面一份 backup.json（原样 JSON，解压就能看，别的工具也能读）
 * 和一份 收藏.md（给人读的）。zip 内部就是 deflate，和 gzip 同一套算法：
 * 315 篇真实收藏实测，6.14 MB 的 JSON 压到 1.6 MB 左右。
 *
 * 为什么不用 brotli / zstd：它们能再省 0.6 MB，但 Hermes 里没有可用的编码器，
 * 得走 WASM 或原生模块，会破坏「一条 gradle 命令出包」这条线。省 0.6 MB 不值这个风险。
 *
 * 为什么自己写 base64：expo-file-system 写二进制只能传 base64 字符串，
 * Hermes 的 btoa 只吃 latin1，中文一进去就坏，所以用字节表自己转。
 */
import { gunzipSync, strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const REVERSE: Record<string, number> = {}
for (let i = 0; i < ALPHABET.length; i += 1) REVERSE[ALPHABET[i]] = i

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '='
  }
  return out
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[\s\r\n]+/g, '')
  const output: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const a = REVERSE[clean[i]] ?? 0
    const b = REVERSE[clean[i + 1]] ?? 0
    const c = clean[i + 2] === '=' || clean[i + 2] === undefined ? 0 : REVERSE[clean[i + 2]] ?? 0
    const d = clean[i + 3] === '=' || clean[i + 3] === undefined ? 0 : REVERSE[clean[i + 3]] ?? 0
    const n = (a << 18) | (b << 12) | (c << 6) | d
    output.push((n >> 16) & 255)
    if (clean[i + 2] !== '=' && clean[i + 2] !== undefined) output.push((n >> 8) & 255)
    if (clean[i + 3] !== '=' && clean[i + 3] !== undefined) output.push(n & 255)
  }
  return Uint8Array.from(output)
}

export const BACKUP_ENTRY = 'backup.json'
export const MARKDOWN_ENTRY = '收藏.md'

export interface EncodedBackup {
  /** zip 的 base64，直接写盘用。 */
  base64: string
  /** 未压缩的 JSON 字节数。 */
  rawBytes: number
  /** 压缩后的 zip 字节数。 */
  zipBytes: number
}

/** backup.json + 收藏.md → zip → base64。level 9 值得：导出不是热路径。 */
export function encodeBackup(json: string, markdown: string): EncodedBackup {
  const raw = strToU8(json)
  const zip = zipSync(
    {
      [BACKUP_ENTRY]: [raw, { level: 9 }],
      [MARKDOWN_ENTRY]: [strToU8(markdown), { level: 9 }],
    },
    // 固定时间戳：同一份数据导两次，zip 的字节也一致（便于比对与去重）
    { mtime: new Date(2026, 0, 1) },
  )
  return { base64: bytesToBase64(zip), rawBytes: raw.length, zipBytes: zip.length }
}

export type BackupKind = 'zip' | 'gzip' | 'plain'

export interface DecodedBackup {
  text: string
  /** 原文件是哪种容器（用魔数判断，不看扩展名）。 */
  kind: BackupKind
}

/**
 * 导入方向：新版 .zip、过渡期的 .json.gz、以及旧版纯 .json 都要能读。
 *
 * 只看文件头——分享面板和网盘经常把后缀改掉。
 * zip 里先找 backup.json，找不到就取第一个 .json 条目。
 */
export function decodeBackupBase64(base64: string): DecodedBackup {
  const bytes = base64ToBytes(base64)

  // PK\x03\x04
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const entries = unzipSync(bytes)
    const names = Object.keys(entries)
    const pick =
      names.find((name) => name === BACKUP_ENTRY) ??
      names.find((name) => name.toLowerCase().endsWith('.json')) ??
      null
    if (!pick) throw new Error('压缩包里没有 backup.json')
    return { text: strFromU8(entries[pick]), kind: 'zip' }
  }

  // 1f 8b：gzip
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return { text: strFromU8(gunzipSync(bytes)), kind: 'gzip' }
  }

  return { text: strFromU8(bytes), kind: 'plain' }
}
