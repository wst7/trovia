import { useEffect, useState } from 'react'

import { subscribeChange } from './bus'

/** A version counter that increments when local data changes, used as the dependency for reloading lists and details. */
export function useLocalRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeChange(() => setRevision((value) => value + 1)), [])
  return revision
}
