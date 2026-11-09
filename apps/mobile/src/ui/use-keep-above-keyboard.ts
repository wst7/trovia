import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'

import { opLog } from '../local/dev-log'

/**
 * Keeps the field being edited above the keyboard.
 *
 * Two things made the earlier attempt fail on a real device:
 *
 * 1. The scroll ran on focus, while the keyboard was still animating in. By the
 *    time it finished, the layout had moved and the field was covered again.
 * 2. `KeyboardAvoidingView` and the manual scroll were both compensating, so
 *    neither landed where intended.
 *
 * So: no KeyboardAvoidingView on screens using this. The list keeps the full
 * window height, the keyboard overlays its bottom, and the content carries extra
 * bottom padding equal to the measured keyboard height. The scroll happens again
 * when `keyboardDidShow` fires — after the layout has settled — using the field
 * that still has focus.
 */
export function useKeepAboveKeyboard() {
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const contentRef = useRef<React.ComponentRef<typeof View>>(null)
  const activeField = useRef<React.RefObject<React.ComponentRef<typeof View> | null> | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  /** Scroll to the very bottom: exact for the last field, and needs no measurement. */
  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [])

  const scrollToField = useCallback((fieldRef: React.RefObject<React.ComponentRef<typeof View> | null>) => {
    const target = fieldRef.current
    if (!target) return
    try {
      target.measureLayout(
        contentRef.current as unknown as number,
        (_x, y) => {
          // Logged so "the field is still covered" can be checked with numbers
          // instead of a screenshot: what was measured, where we scrolled to.
          void opLog('keyboard.measure', { y: Math.round(y), target: Math.round(Math.max(0, y - 120)) })
          // Land the field in the upper third: the keyboard covers the bottom, and
          // a field placed just above it is one keystroke away from being covered
          // again by an autocomplete bar.
          if (Number.isFinite(y) && y >= 0) {
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true })
          } else {
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        },
        () => scrollRef.current?.scrollToEnd({ animated: true }),
      )
    } catch {
      scrollRef.current?.scrollToEnd({ animated: true })
    }
  }, [])

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
      void opLog('keyboard.show', { height: Math.round(event.endCoordinates.height) })
      // Re-run for the field that is still focused: the first attempt happened
      // before the keyboard finished opening.
      if (activeField.current) {
        // One frame so the padding from this state update is laid out first.
        requestAnimationFrame(() => {
          if (activeField.current) scrollToField(activeField.current)
        })
      }
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [scrollToField])

  /**
   * Attach to a field's onFocus. The ref must point at a wrapper around the
   * input, because the input itself may be replaced (a select turning into a
   * text field) without the position changing.
   */
  const keepVisible = useCallback(
    (
      fieldRef: React.RefObject<React.ComponentRef<typeof View> | null>,
      options?: { bottom?: boolean },
    ) =>
      () => {
        activeField.current = fieldRef
        // The last field is the one that always ends up under the keyboard, and
        // "scroll to the end" puts it in view without trusting any measurement.
        const run = options?.bottom ? scrollToEnd : () => scrollToField(fieldRef)
        requestAnimationFrame(run)
      },
    [scrollToEnd, scrollToField],
  )

  /** Attach to onBlur so a later keyboardDidShow does not scroll to a stale field. */
  const releaseFocus = useCallback(() => {
    activeField.current = null
  }, [])

  return { scrollRef, contentRef, keepVisible, releaseFocus, keyboardHeight }
}
