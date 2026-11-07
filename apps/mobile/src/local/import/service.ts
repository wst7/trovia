/**
 * The persistence side of import: pick a file → parse → compare against existing saves → enqueue in bulk.
 *
 * “import means parse” is deliberately not done here: import is only responsible for putting the links into the queue,
 * the actual fetching is left to the existing parse queue, so the user can keep using the phone while parsing runs slowly in the background.
 */
import * as DocumentPicker from 'expo-document-picker'

import { emitChange } from '../bus'
import { decodeBackupBase64 } from '../export-codec'
import * as repo from '../repo'
import { normalizeUrl, parseImport } from './parse'
import type { ImportFormat, ImportItem, RestoreDocument } from './parse'

type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

export interface PickedFile {
  name: string
  format: ImportFormat
  items: ImportItem[]
  /** Only a Trovia backup has this: the copy that carries the body, written straight to the store on restore. */
  documents: RestoreDocument[] | undefined
  skipped: { line: string; reason: string }[]
  /** How many are already saved on this device (judged by the normalized link). */
  existing: number
  fresh: ImportItem[]
}

/** Open the system file picker and parse; returns null when the user cancels. */
export async function pickAndParse(): Promise<PickedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: [
      'text/html',
      'application/json',
      'text/csv',
      'text/plain',
      'application/octet-stream',
      // Our own exported backups: zip (new) and gzip (transitional); different systems report different mimes
      'application/zip',
      'application/x-zip-compressed',
      'application/gzip',
      'application/x-gzip',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (picked.canceled || picked.assets.length === 0) return null

  const asset = picked.assets[0]
  const module = fs()
  if (!module) throw new Error('这台设备上暂时无法读取文件')

  // Read as bytes and detect the container from the file header: zip / gzip / plain text all come in through the same door.
  const base64 = await module.readAsStringAsync(asset.uri, { encoding: 'base64' })
  const { text: content } = decodeBackupBase64(base64)
  const parsed = parseImport(content)

  const existingUrls = await repo.listUrls()
  const known = new Set(existingUrls.map((url) => normalizeUrl(url) ?? url))
  const fresh = parsed.items.filter((item) => !known.has(item.url))

  return {
    name: asset.name ?? '导入文件',
    format: parsed.format,
    items: parsed.items,
    skipped: parsed.skipped,
    existing: parsed.items.length - fresh.length,
    fresh,
    documents: parsed.documents,
  }
}

export interface ImportProgress {
  done: number
  total: number
}

export interface ImportSummary {
  created: number
  duplicate: number
  failed: number
}

/** Write the items into the queue one by one; the caller throttles the progress display. */
/**
 * Restore from one's own backup: do not fetch the web page, write the store straight from what the backup holds.
 *
 * This is a separate path from runImport: an ordinary import has only links and has to be re-fetched; a backup holds the body,
 * so it is still there even when the site is down.
 */
export async function runRestore(
  documents: RestoreDocument[],
  onProgress?: (progress: ImportProgress) => void,
  fileName?: string,
): Promise<ImportSummary> {
  let created = 0
  let duplicate = 0
  let failed = 0

  for (let index = 0; index < documents.length; index += 1) {
    try {
      const result = await repo.restoreDocument(documents[index], fileName ?? '')
      if (result === 'duplicate') duplicate += 1
      else created += 1
    } catch {
      failed += 1
    }
    onProgress?.({ done: index + 1, total: documents.length })
  }

  // Restore writes the store directly and does not go through the parse queue, so it has to announce itself here;
  // otherwise the saved-items screen stays on the pre-import list and needs a manual pull-to-refresh to show anything.
  if (created > 0) emitChange()
  return { created, duplicate, failed }
}

export async function runImport(
  items: ImportItem[],
  onProgress?: (progress: ImportProgress) => void,
  /** File name, written into every saved item's metadata, so the detail page can explain “which file this one came from”. */
  fileName?: string,
): Promise<ImportSummary> {
  let created = 0
  let duplicate = 0
  let failed = 0

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    try {
      const result = await repo.createDocument(
        item.url,
        item.title,
        item.addedAt,
        fileName ? { kind: 'import' as const, file: fileName } : null,
        typeof item.addedAt === 'number',
      )
      if (result.duplicate) duplicate += 1
      else created += 1
    } catch {
      failed += 1
    }
    onProgress?.({ done: index + 1, total: items.length })
  }

  // Refresh the list as soon as the first item is stored; do not wait for the background tidying to finish.
  if (created > 0) emitChange()
  return { created, duplicate, failed }
}
