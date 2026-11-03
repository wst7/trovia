import { useEffect, useRef } from 'react'
import { Animated, Modal, Pressable, Text, View } from 'react-native'

import { Button } from './Button'
import { useT } from '../i18n'

interface ConfirmDialogProps {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 应用内确认框：原生 Alert 的按钮颜色跟系统走，会跳出这套配色，
 * 所以删除这类动作统一用这里。静态卡片 + 一层薄遮罩，不做弹跳。
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT()
  const enter = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(enter, {
      toValue: visible ? 1 : 0,
      duration: 140,
      useNativeDriver: true,
    }).start()
  }, [visible, enter])

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onCancel}>
      <Animated.View className="flex-1 items-center justify-center bg-black/35 px-6" style={{ opacity: enter }}>
        <Pressable
          className="absolute inset-0"
          onPress={onCancel}
          accessibilityLabel={t('ui.closeDialog')}
        />
        <View
          className="w-full max-w-[340px] rounded-md border border-line bg-surface p-5"
          accessibilityViewIsModal
        >
          <Text className="text-heading font-semibold text-ink">{title}</Text>
          <Text className="mt-2 text-body-sm text-muted">{message}</Text>
          <View className="mt-5 flex-row justify-end gap-2">
            <Button label={cancelLabel ?? t('common.cancel')} onPress={onCancel} variant="quiet" size="sm" />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              size="sm"
              variant={destructive ? 'destructive' : 'primary'}
            />
          </View>
        </View>
      </Animated.View>
    </Modal>
  )
}
