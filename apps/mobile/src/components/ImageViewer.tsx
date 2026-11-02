import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { saveImageToLibrary } from '../local/save-image'

/**
 * 全屏看图：双指缩放、放大后拖动、双击放大/还原、左右切换。
 *
 * 不引入手势库：这是全篇唯一需要多点触控的地方，用 PanResponder +
 * Animated 就够，省掉 reanimated 的原生依赖和构建时间。
 */
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 260

export interface ImageViewerProps {
  visible: boolean
  images: string[]
  index: number
  onClose: () => void
  onIndexChange: (index: number) => void
}

export function ImageViewer({ visible, images, index, onClose, onIndexChange }: ImageViewerProps) {
  const insets = useSafeAreaInsets()
  const window = Dimensions.get('window')
  const [size, setSize] = useState({ width: window.width, height: window.height })
  const [loading, setLoading] = useState(true)


  const scale = useRef(new Animated.Value(1)).current
  const translateX = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(0)).current

  // 手势过程中用普通变量记录，松手时再决定落到哪里。
  const gesture = useRef({
    scale: 1,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    startDistance: 0,
    startScale: 1,
    lastTap: 0,
  })

  const reset = useCallback(() => {
    gesture.current.scale = 1
    gesture.current.x = 0
    gesture.current.y = 0
    scale.setValue(1)
    translateX.setValue(0)
    translateY.setValue(0)
  }, [scale, translateX, translateY])

  useEffect(() => {
    if (visible) {
      reset()
      setLoading(true)
    }
  }, [visible, index, reset])

  const current = images[index] ?? images[0]

  const [saving, setSaving] = useState(false)
  /** 存图结果只在这个浮层里说一句，不弹系统对话框。 */
  const [note, setNote] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!current || saving) return
    setSaving(true)
    const result = await saveImageToLibrary(current)
    setSaving(false)
    setNote(
      result.ok
        ? '已存到相册'
        : result.reason === 'permission'
          ? '没有相册权限，去系统设置里允许后再试'
          : result.reason === 'unavailable'
            ? '这台设备不支持保存'
            : '保存失败，图片可能已经失效',
    )
    setTimeout(() => setNote(null), 2600)
  }, [current, saving])

  const clampTranslate = useCallback(
    (value: number, scaleValue: number, max: number) => {
      const bound = Math.max(0, (max * (scaleValue - 1)) / 2)
      return Math.min(bound, Math.max(-bound, value))
    },
    [],
  )

  const settle = useCallback(() => {
    const nextScale = gesture.current.scale < 1.05 ? 1 : Math.min(MAX_SCALE, gesture.current.scale)
    gesture.current.scale = nextScale
    if (nextScale === 1) {
      gesture.current.x = 0
      gesture.current.y = 0
    } else {
      gesture.current.x = clampTranslate(gesture.current.x, nextScale, size.width)
      gesture.current.y = clampTranslate(gesture.current.y, nextScale, size.height)
    }
    Animated.parallel([
      Animated.spring(scale, { toValue: nextScale, useNativeDriver: true, friction: 8 }),
      Animated.spring(translateX, { toValue: gesture.current.x, useNativeDriver: true, friction: 8 }),
      Animated.spring(translateY, { toValue: gesture.current.y, useNativeDriver: true, friction: 8 }),
    ]).start()
  }, [clampTranslate, scale, size.height, size.width, translateX, translateY])

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const touches = event.nativeEvent.touches
        const now = Date.now()
        const sinceLast = now - gesture.current.lastTap
        gesture.current.lastTap = now

        // 双击：在 (1x, 2.5x) 之间切换，并以此点为中心。
        if (touches.length === 1 && sinceLast < DOUBLE_TAP_MS) {
          const zoomedOut = gesture.current.scale <= 1.05
          const nextScale = zoomedOut ? DOUBLE_TAP_SCALE : 1
          gesture.current.scale = nextScale
          if (zoomedOut) {
            const { locationX, locationY } = event.nativeEvent
            gesture.current.x = (size.width / 2 - locationX) * (nextScale - 1)
            gesture.current.y = (size.height / 2 - locationY) * (nextScale - 1)
          } else {
            gesture.current.x = 0
            gesture.current.y = 0
          }
          settle()
          return
        }

        gesture.current.startScale = gesture.current.scale
        gesture.current.startX = gesture.current.x
        gesture.current.startY = gesture.current.y
        if (touches.length >= 2) {
          const [a, b] = touches
          gesture.current.startDistance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
        }
      },
      onPanResponderMove: (event, state) => {
        const touches = event.nativeEvent.touches
        if (touches.length >= 2 && gesture.current.startDistance > 0) {
          const [a, b] = touches
          const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
          const next = Math.min(MAX_SCALE, Math.max(1, (distance / gesture.current.startDistance) * gesture.current.startScale))
          gesture.current.scale = next
          scale.setValue(next)
          return
        }
        if (gesture.current.scale > 1.05) {
          gesture.current.x = gesture.current.startX + state.dx
          gesture.current.y = gesture.current.startY + state.dy
          translateX.setValue(gesture.current.x)
          translateY.setValue(gesture.current.y)
        }
      },
      onPanResponderRelease: (_event, state) => {
        // 没放大时左右滑动切图。
        if (gesture.current.scale <= 1.05 && Math.abs(state.dx) > 60 && Math.abs(state.dy) < 80) {
          const step = state.dx < 0 ? 1 : -1
          const next = index + step
          if (next >= 0 && next < images.length) {
            onIndexChange(next)
            return
          }
        }
        settle()
      },
      onPanResponderTerminate: settle,
    }),
  ).current

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        className="flex-1 bg-black"
        onLayout={(event) => setSize(event.nativeEvent.layout)}
      >
        <Pressable
          className="absolute inset-0 items-center justify-center"
          onPress={onClose}
          accessibilityLabel="关闭图片"
        >
          <Animated.View
            {...responder.panHandlers}
            style={{
              width: size.width,
              height: size.height,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ translateX }, { translateY }, { scale }],
            }}
          >
            {current ? (
              <Image
                source={{ uri: current }}
                style={{ width: size.width, height: size.height }}
                resizeMode="contain"
                onLoadEnd={() => setLoading(false)}
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </Animated.View>
        </Pressable>

        {images.length > 1 ? (
          <View
            pointerEvents="none"
            className="absolute left-0 right-0 items-center"
            style={{ top: insets.top + 12 }}
          >
            <View className="rounded-full bg-black/55 px-2.5 py-1">
              <Text className="text-caption text-white/85">
                {index + 1} / {images.length}
              </Text>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
            <Text className="text-caption text-white/50">加载中…</Text>
          </View>
        ) : null}

        <Pressable
          onPress={onClose}
          className="absolute right-4 h-11 w-11 items-center justify-center rounded-full bg-black/55"
          style={{ top: insets.top + 8 }}
          accessibilityLabel="关闭"
        >
          <Text className="text-body text-white">✕</Text>
        </Pressable>

        <Pressable
          onPress={() => void handleSave()}
          disabled={saving}
          className="absolute left-4 h-11 items-center justify-center rounded-full bg-black/55 px-4"
          style={{ top: insets.top + 8, opacity: saving ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel="保存这张图片到相册"
        >
          <Text className="text-caption text-white">{saving ? '保存中…' : '保存'}</Text>
        </Pressable>

        {note ? (
          <View
            pointerEvents="none"
            className="absolute left-0 right-0 items-center"
            style={{ bottom: insets.bottom + 32 }}
          >
            <View className="rounded-full bg-black/70 px-3 py-1.5">
              <Text className="text-caption text-white">{note}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}
