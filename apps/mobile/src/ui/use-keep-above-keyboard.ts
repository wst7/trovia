import { useCallback, useEffect, useRef, useState } from 'react'
import { Dimensions, Keyboard, ScrollView, View } from 'react-native'

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
  // The latest height, readable from callbacks that must not re-subscribe.
  const heightRef = useRef(0)

  /**
   * After the scroll settles, check where the field actually landed.
   *
   * Keyboard height is not a constant: candidate strips appear and disappear,
   * the user switches IME, Chinese and English keyboards differ. The reported
   * height can therefore be stale by the time someone types. Measuring the field
   * against the visible area and correcting by the measured overflow makes the
   * result right regardless of what the keyboard claimed.
   */
  const verifyVisible = useCallback((fieldRef: React.RefObject<React.ComponentRef<typeof View> | null>) => {
    const target = fieldRef.current
    if (!target) return
    const height = heightRef.current
    try {
      target.measureInWindow((_x, y, _w, h) => {
        const windowHeight = Dimensions.get('window').height
        // 24dp of breathing room so the caret is not on the boundary.
        const limit = windowHeight - height - 24
        const overflow = y + h - limit
        if (!height || overflow <= 0) return
        void opLog('keyboard.correct', { overflow: Math.round(overflow) })
        scrollRef.current?.scrollToEnd({ animated: true })
      })
    } catch {
      // Measurement is a best-effort correction; the scroll above already ran.
    }
  }, [])

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
      heightRef.current = event.endCoordinates.height
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
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      heightRef.current = 0
      setKeyboardHeight(0)
    })
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
        // After the keyboard and the scroll have both settled, confirm and
        // correct — twice, because a candidate strip can slide in a moment later
        // and make the keyboard taller than the height reported at show time.
        setTimeout(() => verifyVisible(fieldRef), 420)
        setTimeout(() => verifyVisible(fieldRef), 1200)
      },
    [scrollToEnd, scrollToField, verifyVisible],
  )

  /** Attach to onBlur so a later keyboardDidShow does not scroll to a stale field. */
  const releaseFocus = useCallback(() => {
    activeField.current = null
  }, [])

  return { scrollRef, contentRef, keepVisible, releaseFocus, keyboardHeight }
}
