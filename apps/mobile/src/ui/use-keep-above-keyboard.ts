import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'

/**
 * Keeps the field being edited above the keyboard.
 *
 * `KeyboardAvoidingView` only shrinks the area it wraps; it does not scroll the
 * focused input into that area on Android the way iOS does. With a form taller
 * than the shortened viewport, tapping the last field left it underneath the
 * keyboard — which is exactly what the settings screens did.
 *
 * So this does the missing half: on focus, measure the field against the scroll
 * content and scroll it to the top third of the visible area, and keep extra
 * bottom padding while the keyboard is up so the last field can actually reach
 * that position.
 */
export function useKeepAboveKeyboard() {
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const contentRef = useRef<React.ComponentRef<typeof View>>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  /**
   * Handler for one field. Measuring instead of guessing an offset keeps this
   * working when rows are added, hidden behind a switch, or reordered.
   */
  const keepVisible = useCallback(
    (
      fieldRef: React.RefObject<React.ComponentRef<typeof View> | null>,
      options?: { fallbackToEnd?: boolean },
    ) =>
      () => {
        // The keyboard animates in after focus; measuring immediately would use
        // the pre-keyboard layout.
        requestAnimationFrame(() => {
          const scrollToField = (y: number) => {
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 96), animated: true })
          }
          try {
            fieldRef.current?.measureLayout(
              contentRef.current as unknown as React.ComponentRef<typeof View>,
              (_x, y) => {
                if (Number.isFinite(y) && y >= 0) scrollToField(y)
                else if (options?.fallbackToEnd) scrollRef.current?.scrollToEnd({ animated: true })
              },
              () => {
                // Measuring can fail on a different renderer; the last field can
                // still be reached by scrolling to the end of the form.
                if (options?.fallbackToEnd) scrollRef.current?.scrollToEnd({ animated: true })
              },
            )
          } catch {
            if (options?.fallbackToEnd) scrollRef.current?.scrollToEnd({ animated: true })
          }
        })
      },
    [],
  )

  return { scrollRef, contentRef, keepVisible, keyboardHeight }
}
