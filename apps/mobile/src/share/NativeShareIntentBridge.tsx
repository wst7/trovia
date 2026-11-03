import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'
import { useShareIntent } from 'expo-share-intent'
import { extractHttpUrl, isValidHttpUrl } from '@trovia/shared'

import { titleHintFrom } from '../local/util'
import { useToast } from '../providers/ToastProvider'

/** 只在 development build / 正式包中加载，见 ShareIntentBridge。 */
export default function NativeShareIntentBridge() {
  const router = useRouter()
  const { toast } = useToast()
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    resetOnBackground: false,
  })

  const handledKey = useRef<string | null>(null)

  useEffect(() => {
    if (!hasShareIntent) {
      handledKey.current = null
      return
    }

    const webUrl =
      shareIntent.webUrl && isValidHttpUrl(shareIntent.webUrl) ? shareIntent.webUrl : null
    const url = webUrl ?? extractHttpUrl(shareIntent.text ?? '')
    const key = `${shareIntent.type ?? ''}|${url ?? ''}|${shareIntent.text ?? ''}`
    if (handledKey.current === key) return
    handledKey.current = key

    // 必须在任何异步保存之前重置原生 payload，避免冷启动/重渲染重复处理。
    resetShareIntent()

    if (!url) {
      toast('这次分享里没有网页链接。', { type: 'warning' })
      return
    }

    // 分享文字里通常带着标题；抓不到正文时用它兜底，而不是只留一串网址。
    const hint = titleHintFrom(shareIntent.text ?? '', url) ?? shareIntent.meta?.title ?? null

    // 不需要登录：直接带着链接进入保存页，数据落在本机。
    router.replace({ pathname: '/share', params: { url, ...(hint ? { hint } : {}) } })
  }, [hasShareIntent, shareIntent, router, toast])

  return null
}
