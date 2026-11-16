import { useRef } from 'react'
import type { GestureResponderEvent } from 'react-native'

/** Beyond this distance it is no longer a tap; a scrolling finger must not open a detail page. */
const MOVE_LIMIT = 10
/** Holding too long is not a tap either; some rows have no long-press action and still must not navigate. */
const LONG_PRESS_MS = 450

/**
 * Tap guard for list rows.
 *
 * Two real problems:
 *   1. after a long press enters multi-select, some platforms still fire onPress on release;
 *   2. during a scroll the finger moves, yet Pressable may still fire onPress on release.
 *
 * Record the start position and time, then check both in onPress; a row that
 * already handled a long press swallows the following onPress.
 */
export function useTapGuard() {
  const start = useRef<{ x: number; y: number; at: number } | null>(null)
  const longPressed = useRef(false)

  return {
    onPressIn(event: GestureResponderEvent) {
      start.current = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
        at: Date.now(),
      }
      longPressed.current = false
    },
    markLongPress() {
      longPressed.current = true
    },
    shouldPress(event: GestureResponderEvent): boolean {
      if (longPressed.current) {
        longPressed.current = false
        start.current = null
        return false
      }
      const from = start.current
      start.current = null
      if (!from) return true
      if (Date.now() - from.at > LONG_PRESS_MS) return false
      const dx = event.nativeEvent.pageX - from.x
      const dy = event.nativeEvent.pageY - from.y
      return Math.hypot(dx, dy) <= MOVE_LIMIT
    },
  }
}
