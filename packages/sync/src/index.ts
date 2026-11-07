/**
 * Trovia · multi-device sync engine (transport-agnostic)
 *
 * The key design tradeoff: **the sync logic knows no particular cloud drive**. The engine talks to a single
 * `SyncTarget` — being able to list a directory, read, write and delete files is all sync needs.
 *
 * So the same protocol can run on:
 *   - WebDAV (Nutstore / Nextcloud / Synology)
 *   - OneDrive / Google Drive / Dropbox (a thin wrapper over each API)
 *   - iCloud Drive (the local ubiquity container; Apple handles the transport)
 *   - our own hosted bucket (S3-compatible + account quota)
 * Changing cloud drives = changing one adapter, without touching the protocol or the database.
 *
 * Storage layout (one file per document, avoiding whole-library overwrite conflicts):
 *   trovia/docs/<doc_id>.json        the document itself + metadata
 *   trovia/blobs/<sha256>            attachments such as images, content-addressed, duplicates are not re-uploaded
 *   trovia/devices/<device_id>.json  last sync time per device, for troubleshooting only
 */

export { WebDavTarget } from './webdav'
// LocalDirTarget depends on node:fs and is used only on desktop/in tests; it is not exported from the entry point,
// otherwise a mobile import of @trovia/sync would drag node builtins into RN's type check.

export interface SyncTarget {
  /** List the files under a prefix; path is relative to the root, e.g. `docs/abc.json`. */
  list(prefix: string): Promise<SyncEntry[]>
  read(path: string): Promise<string | null>
  write(path: string, body: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface SyncEntry {
  path: string
  /** Some cloud drives provide etag/mtime to skip unchanged files; without it, read every time. */
  etag?: string
  size?: number
}

/** One saved article to sync. The body and image references live in payload; future encryption would only touch this. */
export interface SyncRecord {
  id: string
  /** ISO time, the main basis for conflict resolution. */
  updated_at: string
  /** Non-null means this is a tombstone (deleted); tombstones must be synced too, otherwise another device resurrects it. */
  deleted_at: string | null
  /** +1 on every local change, to tell "unchanged" apart from "changed on both sides". */
  rev: number
  payload: Record<string, unknown>
}

/** The minimum interface of the local database: the engine never touches SQLite, and tests use an in-memory implementation. */
export interface LocalStore {
  /** Records changed since the last sync (including creations and deletions). */
  listDirty(): Promise<SyncRecord[]>
  /** doc_id → the rev seen at the last sync. The "base" of the three-way comparison; without it you cannot tell who changed first. */
  baseRevs(): Promise<Map<string, number>>
  /**
   * doc_id → the etag of the remote file at the last sync.
   * With it, unchanged files can be skipped rather than reading the whole cloud every round; without it, fall back to "read every time".
   */
  baseEtags?(): Promise<Map<string, string>>
  /** Land records according to the remote state (updating the base rev to the remote's along the way). */
  applyRemote(records: SyncRecord[]): Promise<void>
  /** Called after a successful push: clear dirty and record the base rev as this record's rev. */
  markSynced(records: SyncRecord[], syncedAt: string, etags?: Map<string, string>): Promise<void>
}

export interface SyncReport {
  pushed: number
  pulled: number
  /** How many remote tombstones were landed (and therefore deleted locally). */
  deleted: number
  /** Copies kept because both sides changed. */
  conflicts: number
  conflictNames: string[]
  /** How many files actually sit in the cloud docs/: 0 and "already up to date" are not the same thing, and the UI has to say so clearly. */
  remoteFiles: number
  /** Files that were listed but could not be read / parsed: look at this when the cloud count and the local count disagree. */
  skipped: number
  syncedAt: string
}

const DOCS_PREFIX = 'docs/'

function docPath(id: string): string {
  return `${DOCS_PREFIX}${encodeURIComponent(id)}.json`
}

function isRecord(value: unknown): value is SyncRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SyncRecord>
  return (
    typeof record.id === 'string' &&
    typeof record.updated_at === 'string' &&
    typeof record.rev === 'number' &&
    (record.deleted_at === null || typeof record.deleted_at === 'string') &&
    typeof record.payload === 'object' &&
    record.payload !== null
  )
}

/** Whoever is newer wins; equal times fall back to rev, and equal revs to content length as a deterministic tiebreak. */
function newer(a: SyncRecord, b: SyncRecord): boolean {
  if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at
  if (a.rev !== b.rev) return a.rev > b.rev
  return JSON.stringify(a.payload).length >= JSON.stringify(b.payload).length
}

export interface SyncOptions {
  target: SyncTarget
  store: LocalStore
  deviceId: string
  /** Injected clock; tests pin the time, production uses () => new Date().toISOString(). */
  now: () => string
  /** Maximum records handled in one sync, so the first sync does not read the whole library into memory. */
  limit?: number
}

/**
 * Run one sync round: look at the remote first, then decide to push/pull/keep a copy.
 *
 * Conflict detection is a three-way comparison: `local.rev > base && remote.rev > base`,
 * i.e. "I changed it, and you also changed it after I last saw it". At that point it does not guess who is right:
 * the newer one takes the main entry and the other is kept as a conflict copy — neither side's content is silently dropped.
 */
export async function syncOnce(options: SyncOptions): Promise<SyncReport> {
  const { target, store, deviceId, now, limit = 500 } = options
  const syncedAt = now()

  const dirty = await store.listDirty()
  const dirtyById = new Map(dirty.map((record) => [record.id, record]))
  const baseRevs = await store.baseRevs()

  const allEntries = await target.list(DOCS_PREFIX)
  const baseEtags = (await store.baseEtags?.()) ?? new Map<string, string>()
  /** Files that were listed but could not be read / parsed. */
  let skipped = 0
  const remoteById = new Map<string, SyncRecord>()
  const seenEtags = new Map<string, string>()

  // The scan covers all entries, not just the first limit — otherwise files past entry N would never get a turn.
  // limit now bounds "how many files are read in this round"; unchanged ones (etag matching the base,
  // and nothing changed locally) are skipped outright, taking neither quota nor a request.
  let reads = 0
  for (const entry of allEntries) {
    const id = idFromPath(entry.path)
    if (!id) continue
    // "Unchanged" requires both the base rev and a matching etag: with the etag alone,
    // once the base rev is lost (the database was cleared), this entry would never be read again.
    const unchanged =
      Boolean(entry.etag) &&
      baseEtags.get(id) === entry.etag &&
      baseRevs.has(id) &&
      !dirtyById.has(id)
    if (unchanged) {
      if (entry.etag) seenEtags.set(id, entry.etag)
      continue
    }
    if (reads >= limit) continue
    reads += 1
    if (entry.etag) seenEtags.set(id, entry.etag)
    const raw = await target.read(entry.path)
    if (!raw) {
      skipped += 1
      continue
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed)) remoteById.set(parsed.id, parsed)
    } catch {
      // Skip bad files: the previous write may have been cut off, and the next round overwrites them with the correct version.
      skipped += 1
    }
  }

  let pushed = 0
  let pulled = 0
  let deleted = 0
  let conflicts = 0
  const conflictNames: string[] = []
  const applied: SyncRecord[] = []
  const pushedRecords: SyncRecord[] = []

  /** Push one record up and add it to the list to be marked. */
  const push = async (record: SyncRecord) => {
    await target.write(docPath(record.id), JSON.stringify(record))
    pushed += 1
    pushedRecords.push(record)
  }

  /** Pull one record down, count deletions, and note a human-readable name along the way. */
  const pull = (record: SyncRecord) => {
    applied.push(record)
    pulled += 1
    if (record.deleted_at) deleted += 1
  }

  const ids = new Set<string>([...dirtyById.keys(), ...remoteById.keys()])

  for (const id of ids) {
    const local = dirtyById.get(id) ?? null
    const remote = remoteById.get(id) ?? null

    // Local only: push it up (tombstones included).
    if (local && !remote) {
      await push(local)
      continue
    }

    // Remote only: two cases.
    // One, this device really does not have it (pull); two, this device has it but it has not changed since the last sync —
    // such records do not appear in listDirty and can only be recognized from the base rev, otherwise the whole library would be re-pulled every round.
    if (!local && remote) {
      const base = baseRevs.get(id) ?? 0
      if (base > 0) {
        if (remote.rev > base) pull(remote)
        // Equal rev means both sides agree; nothing to do.
        continue
      }
      pull(remote)
      continue
    }

    if (!local || !remote) continue

    // Both sides agree: only the base rev needs aligning.
    if (local.rev === remote.rev && local.updated_at === remote.updated_at) {
      pushedRecords.push(local)
      continue
    }

    const base = baseRevs.get(id) ?? 0
    const bothChanged = local.rev > base && remote.rev > base

    if (bothChanged) {
      const winner = newer(local, remote) ? local : remote
      const loser = winner === local ? remote : local
      const copy = conflictCopy(loser, deviceId, syncedAt)
      applied.push(copy)
      conflictNames.push(String(copy.payload.title ?? copy.id))
      conflicts += 1

      if (winner === local) await push(local)
      else pull(remote)
      continue
    }

    if (newer(local, remote)) {
      await push(local)
    } else {
      pull(remote)
    }
  }

  if (applied.length > 0) await store.applyRemote(applied)
  // Pulled records must also record the base rev: otherwise the next round sees "local rev > 0 and remote rev > 0" and judges
  // that both sides changed — which on a real device shows up as "I deleted an article synced from another device and it came back as a conflict copy".
  // Mark once even if nothing advanced this time: the "last sync" in the UI should mean "last attempt".
  await store.markSynced([...pushedRecords, ...applied], syncedAt, seenEtags)

  return {
    pushed,
    pulled,
    deleted,
    conflicts,
    conflictNames,
    remoteFiles: allEntries.length,
    skipped,
    syncedAt,
  }
}

/** `docs/<id>.json` → `<id>`; entries of any other shape are ignored. */
function idFromPath(path: string): string | null {
  const match = /^docs\/(.+)\.json$/.exec(path)
  return match ? match[1] : null
}

/** Conflict copy: a new id and the conflict-copy suffix on the title, so neither side's content is silently dropped. */
function conflictCopy(record: SyncRecord, deviceId: string, at: string): SyncRecord {
  const stamp = at.replace(/[-:.TZ]/g, '').slice(0, 14)
  const title = typeof record.payload.title === 'string' ? record.payload.title : ''
  return {
    id: `${record.id}-conflict-${stamp}-${deviceId.slice(0, 4)}`,
    updated_at: at,
    deleted_at: null,
    rev: 1,
    payload: { ...record.payload, title: title ? `${title}（冲突副本）` : '冲突副本' },
  }
}
