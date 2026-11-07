/**
 * Image backfill: saves that arrived through sync or import only carry image URLs, with no files on this device yet.
 *
 * It does not re-run parsing (that would recompute body, summary and keywords and overwrite the version that came in through sync);
 * it does exactly one thing: download the images from the addresses in images to this device, then write image_files back.
 *
 * The limit is deliberate: only a few images per pass, so that returning to the foreground does not turn into a hundreds-of-megabytes download.
 */
import { cacheImages, usableImageCount } from './imageStore'
import * as repo from './repo'

const BATCH = 4

let running = false

export async function hydrateImages(batch = BATCH): Promise<number> {
  if (running) return 0
  running = true
  let done = 0
  try {
    const candidates = await repo.listWithImages(batch)
    for (const doc of candidates) {
      try {
        // A path recorded in the field does not count; only real bytes on disk do. Otherwise an empty file left behind by a 404 keeps
        // this document stuck at "already saved" forever and it never retries.
        if ((await usableImageCount(doc.imageFiles)) > 0) continue

        const files = await cacheImages(doc.id, doc.images, doc.url)
        // If not one image succeeded, leave it as is and try again next time; do not write a string of empty values that marks it as backfilled.
        if (files.some((file) => file.length > 0)) {
          await repo.setImageFiles(doc.id, files)
          done += 1
        }
      } catch {
        // One document failing does not affect the others
      }
    }
  } finally {
    running = false
  }
  return done
}
