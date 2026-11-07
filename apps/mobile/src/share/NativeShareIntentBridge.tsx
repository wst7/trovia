import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'
import { useShareIntent } from 'expo-share-intent'
import { extractHttpUrl, isValidHttpUrl } from '@trovia/shared'

import { titleHintFrom } from '../local/util'
import { useToast } from '../providers/ToastProvider'

/** Loaded only in a development build / production package, see ShareIntentBridge. */
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

    // The native payload must be reset before any asynchronous save, so a cold start / re-render does not process it twice.
    resetShareIntent()

    if (!url) {
      toast('这次分享里没有网页链接。', { type: 'warning' })
      return
    }

    // The shared text usually carries the title; use it as the fallback when no body can be fetched, rather than leaving only a bare URL.
    const hint = titleHintFrom(shareIntent.text ?? '', url) ?? shareIntent.meta?.title ?? null

    // No login needed: go straight into the save screen with the link, and the data lands on the device.
    router.replace({ pathname: '/share', params: { url, ...(hint ? { hint } : {}) } })
  }, [hasShareIntent, shareIntent, router, toast])

  return null
}
