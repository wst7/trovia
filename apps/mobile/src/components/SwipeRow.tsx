/**
 * Row container that reveals "Delete" on a left swipe.
 *
 * PanResponder + Animated only, no gesture library: this interaction only needs "drag sideways,
 * snap on release", which is not worth another native dependency.
 *
 * Only one row may be open at a time — the parent's openId decides it, so opening any row
 * closes the others, keeping a row of red buttons from spreading across the screen.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Animated, PanResponder, Pressable, View } from 'react-native'
import { Text } from '../ui/text'

import { useT } from '../i18n'
import { usePalette } from '../ui/palette'

const ACTION_WIDTH = 88

export function SwipeRow({
  children,
  open,
  onOpen,
  onClose,
  onDelete,
  disabled = false,
}: {
  children: React.ReactNode
  open: boolean
  onOpen: () => void
  onClose: () => void
  onDelete: () => void
  /** No swipe in multi-select mode: that whole row is "select/deselect". */
  disabled?: boolean
}) {
  const t = useT()
  const p = usePalette()
  const translate = useRef(new Animated.Value(0)).current
  const openedRef = useRef(open)
  openedRef.current = open

  useEffect(() => {
    Animated.spring(translate, {
      toValue: open ? -ACTION_WIDTH : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start()
  }, [open, translate])

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Take over only when the horizontal intent is clear; a vertical drag still scrolls the list.
        onMoveShouldSetPanResponder: (_, gesture) =>
          !disabled &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderMove: (_, gesture) => {
          const base = openedRef.current ? -ACTION_WIDTH : 0
          const next = Math.min(0, Math.max(-ACTION_WIDTH, base + gesture.dx))
          translate.setValue(next)
        },
        onPanResponderRelease: (_, gesture) => {
          const base = openedRef.current ? -ACTION_WIDTH : 0
          const next = base + gesture.dx
          if (next < -ACTION_WIDTH / 2) onOpen()
          else onClose()
        },
        onPanResponderTerminate: () => {
          Animated.spring(translate, {
            toValue: openedRef.current ? -ACTION_WIDTH : 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start()
        },
      }),
    [disabled, onClose, onOpen, translate],
  )

  return (
    <View className="overflow-hidden">
      <View
        className="absolute bottom-0 right-0 top-0 items-center justify-center bg-danger"
        style={{ width: ACTION_WIDTH }}
        // While closed it shouldn't be hit by the screen reader or taps: it is only hidden under the row.
        pointerEvents={open ? 'auto' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        <Pressable
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={t('list.delete')}
          style={{ width: ACTION_WIDTH, height: '100%', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text className="text-body-sm font-medium" style={{ color: p.onAccent }}>
            {t('list.delete')}
          </Text>
        </Pressable>
      </View>
      {/* Background is the canvas color, not surface: a row is a row in a table, not a card.
          Using surface would turn the list into a stack of white cards in light mode, fighting the hairline-separated layout. */}
      <Animated.View style={{ transform: [{ translateX: translate }], backgroundColor: p.canvas }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  )
}
