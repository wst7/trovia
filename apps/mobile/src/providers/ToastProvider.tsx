import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type ToastType = 'info' | 'success' | 'warning' | 'error'

interface ToastAction {
  label: string
  onPress: () => void
}

interface ToastOptions {
  type?: ToastType
  action?: ToastAction
  duration?: number
}

interface ToastItem {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/**
 * Toasts: an ink-coloured inverted bar floating above the navigation bar, at most 3 kept at a time.
 * No icons per type, no background per type — the text says what it says, and the status is already in that sentence.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const insets = useSafeAreaInsets()

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++
      const item: ToastItem = {
        id,
        message,
        type: options.type ?? 'info',
        action: options.action,
      }
      setItems((current) => [...current.slice(-2), item])
      const timer = setTimeout(() => dismiss(id), options.duration ?? 6000)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer))
      timers.current.clear()
    },
    [],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View
        pointerEvents="box-none"
        className="absolute inset-x-4 gap-2"
        style={{ bottom: insets.bottom + 72 }}
      >
        {items.map((item) => (
          <Snackbar key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  )
}

function Snackbar({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const enter = useRef(new Animated.Value(0)).current
  const action = item.action

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start()
  }, [enter])

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      className="flex-row items-start gap-3 rounded-sm bg-ink px-4 py-3"
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <View className="flex-1">
        <Text className="text-body-sm text-canvas">{item.message}</Text>
        {action ? (
          <Pressable
            onPress={() => {
              action.onPress()
              onDismiss()
            }}
            accessibilityRole="button"
            hitSlop={8}
            className="mt-1 self-start"
          >
            {({ pressed }) => (
              <Text
                className="text-label text-canvas underline"
                style={{ opacity: pressed ? 0.6 : 1 }}
              >
                {action.label}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="关闭提示" hitSlop={10}>
        {({ pressed }) => (
          <Text className="text-label text-canvas" style={{ opacity: pressed ? 0.5 : 0.45 }}>
            ✕
          </Text>
        )}
      </Pressable>
    </Animated.View>
  )
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used within ToastProvider')
  return value
}
