import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Dimensions, Image, Modal, PanResponder, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { saveImageToLibrary } from '../local/save-image'
import { useT } from '../i18n'

/**
 * Fullscreen image viewing: pinch to zoom, drag after zooming in, double tap to zoom in/restore, swipe left/right to switch.
 *
 * No gesture library: this is the only place in the whole app that needs multi-touch, so PanResponder +
 * Animated are enough, saving the native dependency and build time that reanimated would add.
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
  const t = useT()
  const insets = useSafeAreaInsets()
  const window = Dimensions.get('window')
  const [size, setSize] = useState({ width: window.width, height: window.height })
  const [loading, setLoading] = useState(true)


  const scale = useRef(new Animated.Value(1)).current
  const translateX = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(0)).current

  // Track it in a plain variable during the gesture, then decide where it lands on release.
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
  /** The save result is mentioned only in this overlay, without a system dialog. */
  const [note, setNote] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!current || saving) return
    setSaving(true)
    const result = await saveImageToLibrary(current)
    setSaving(false)
    setNote(
      result.ok
        ? t('viewer.saved')
        : result.reason === 'permission'
          ? t('viewer.noPermission')
          : result.reason === 'unavailable'
            ? t('viewer.unsupported')
            : t('viewer.saveFailed'),
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

        // Double tap: toggle between (1x, 2.5x), centered on this point.
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
        // Swipe left/right to change image while not zoomed in.
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
          accessibilityLabel={t('viewer.closeImage')}
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
            <Text className="text-caption text-white/50">{t('common.loadingImage')}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={onClose}
          className="absolute right-4 h-11 w-11 items-center justify-center rounded-full bg-black/55"
          style={{ top: insets.top + 8 }}
          accessibilityLabel={t('common.close')}
        >
          <Text className="text-body text-white">✕</Text>
        </Pressable>

        <Pressable
          onPress={() => void handleSave()}
          disabled={saving}
          className="absolute left-4 h-11 items-center justify-center rounded-full bg-black/55 px-4"
          style={{ top: insets.top + 8, opacity: saving ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel={t('viewer.saveA11y')}
        >
          <Text className="text-caption text-white">{saving ? t('viewer.saving') : t('common.save')}</Text>
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
