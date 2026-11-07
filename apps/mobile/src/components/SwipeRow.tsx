/**
 * 左滑露出「删除」的行容器。
 *
 * 只用 PanResponder + Animated，不引入手势库：这套交互只要求「横向拖、
 * 松手吸附」，多引一个原生依赖不划算，也会让热更新多一层风险。
 *
 * 同一时刻只允许一行打开——由父组件的 openId 决定，滑开任意一行时别的行
 * 会自动合上，避免一排红按钮摊在屏幕上。
 */
import { useEffect, useMemo, useRef } from 'react'
import { Animated, PanResponder, Pressable, Text, View } from 'react-native'

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
  /** 多选模式下不响应滑动：那一行整块都是「选中/取消」。 */
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
        // 横向意图足够明显才接管，竖着滑动仍然是滚动列表。
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
        // 合上的时候不该被读屏和点击命中：它只是藏在行下面。
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
      <Animated.View style={{ transform: [{ translateX: translate }], backgroundColor: p.surface }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  )
}
