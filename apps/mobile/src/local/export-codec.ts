/**
 * Backup encode/decode.
 *
 * What is exported is a .zip: a backup.json inside (raw JSON, viewable once unzipped, readable by other tools)
 * plus the Markdown export (MARKDOWN_ENTRY, meant for humans). Inside the zip it is plain deflate, the same algorithm as gzip:
 * measured on 315 real saved articles, a 6.14 MB JSON compresses to around 1.6 MB.
 *
 * Why not brotli / zstd: they would save another 0.6 MB, but Hermes has no usable encoder,
 * so it would mean WASM or a native module, which breaks the "one gradle command builds the app" line. 0.6 MB is not worth that risk.
 *
 * Why write base64 by hand: expo-file-system can only write binary as a base64 string,
 * and Hermes' btoa only accepts latin1, so Chinese corrupts it; hence a byte table and our own conversion.
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
  /** base64 of the zip, for writing straight to disk. */
  base64: string
  /** Byte count of the uncompressed JSON. */
  rawBytes: number
  /** Byte count of the compressed zip. */
  zipBytes: number
}

/** backup.json + MARKDOWN_ENTRY → zip → base64. level 9 is worth it: export is not a hot path. */
export function encodeBackup(json: string, markdown: string): EncodedBackup {
  const raw = strToU8(json)
  const zip = zipSync(
    {
      [BACKUP_ENTRY]: [raw, { level: 9 }],
      [MARKDOWN_ENTRY]: [strToU8(markdown), { level: 9 }],
    },
    // Fixed timestamp: exporting the same data twice produces identical zip bytes (easy to compare and dedupe)
    { mtime: new Date(2026, 0, 1) },
  )
  return { base64: bytesToBase64(zip), rawBytes: raw.length, zipBytes: zip.length }
}

export type BackupKind = 'zip' | 'gzip' | 'plain'

export interface DecodedBackup {
  text: string
  /** Which container the source file is (judged by magic number, not by extension). */
  kind: BackupKind
}

/**
 * Import directions: the new .zip, the transitional .json.gz and the legacy plain .json all have to be readable.
 *
 * Look only at the file header — share sheets and cloud drives often change the suffix.
 * Inside the zip, look for backup.json first; if it is missing, take the first .json entry.
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
