import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { extractHttpUrl, isValidHttpUrl } from '@xunji/shared'

import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { titleHintFrom } from '../local/util'
import { useToast } from '../providers/ToastProvider'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/** 上次已经问过的链接：同一个链接不重复弹，换了一条再问。 */
const LAST_OFFERED_KEY = 'xunji.clipboard.v1'
const MAX_CLIPBOARD_CHARS = 5000
const CHECK_DELAY_MS = 900

interface Candidate {
  url: string
  hint: string | null
}

/**
 * 打开或回到 App 时看一眼剪贴板：如果有网页链接且还没收藏，就问要不要保存。
 *
 * 只读一次、只用来判断“是不是链接”。剪贴板文字不写日志、不落库；
 * 用户点保存时，链接随保存进入本机数据库，标题种子只在内存里传给保存流程。
 */
export function ClipboardPrompt({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const { toast } = useToast()
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const checkingRef = useRef(false)
  const savingRef = useRef(false)

  const check = useCallback(async () => {
    if (!enabled || checkingRef.current || savingRef.current) return
    if (AppState.currentState !== 'active') return
    // 分享进入的保存页有自己的流程，别叠一层剪贴板弹窗。
    if (pathnameRef.current.startsWith('/share')) return

    checkingRef.current = true
    try {
      if (!(await Clipboard.hasStringAsync())) return
      const text = (await Clipboard.getStringAsync()).trim()
      if (!text || text.length > MAX_CLIPBOARD_CHARS) return

      const url = extractHttpUrl(text)
      if (!url || !isValidHttpUrl(url)) return

      const last = await AsyncStorage.getItem(LAST_OFFERED_KEY)
      if (last === url) return

      if (await repo.hasDocument(url)) {
        await AsyncStorage.setItem(LAST_OFFERED_KEY, url)
        return
      }
      setCandidate({ url, hint: titleHintFrom(text, url) })
    } catch {
      // 剪贴板不可用（iOS 未允许粘贴、后台、系统限制）时静默跳过。
    } finally {
      checkingRef.current = false
    }
  }, [enabled])

  // 冷启动进入首页后问一次。
  useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(() => void check(), CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, check])

  // 从后台回来时再看一眼：这时剪贴板通常刚被其他 App 写入。
  useEffect(() => {
    if (!enabled) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setTimeout(() => void check(), 500)
    })
    return () => sub.remove()
  }, [enabled, check])

  async function handleSave() {
    if (!candidate) return
    const { url, hint } = candidate
    savingRef.current = true
    setCandidate(null)
    await AsyncStorage.setItem(LAST_OFFERED_KEY, url).catch(() => undefined)
    try {
      const res = await repo.createDocument(url, hint)
      if (res.duplicate) {
        toast('这篇内容已经保存过了。', {
          action: {
            label: '打开已有收藏',
            onPress: () => router.push(`/documents/${res.id}`),
          },
        })
      } else {
        toast('已保存，正在本机整理内容……', {
          type: 'success',
          action: { label: '查看', onPress: () => router.push(`/documents/${res.id}`) },
        })
        void processPendingQueue()
      }
    } catch {
      toast('保存失败，请稍后重试。', { type: 'error' })
    } finally {
      savingRef.current = false
    }
  }

  function handleDismiss() {
    if (!candidate) return
    void AsyncStorage.setItem(LAST_OFFERED_KEY, candidate.url).catch(() => undefined)
    setCandidate(null)
  }

  const message = candidate
    ? [candidate.hint ? `「${candidate.hint}」` : null, candidate.url]
        .filter(Boolean)
        .join('\n')
    : ''

  return (
    <ConfirmDialog
      visible={candidate !== null}
      title="保存剪贴板里的链接？"
      message={message}
      confirmLabel="保存"
      cancelLabel="不用"
      onConfirm={() => void handleSave()}
      onCancel={handleDismiss}
    />
  )
}
