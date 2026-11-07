import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { extractHttpUrl, isValidHttpUrl } from '@trovia/shared'

import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { titleHintFrom } from '../local/util'
import { useToast } from '../providers/ToastProvider'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useT } from '../i18n'

/** The link already asked about last time: the same link is not offered twice, and a different one is asked about again. */
const LAST_OFFERED_KEY = 'trovia.clipboard.v1'
// The key from before the rename: only read to get “the link already asked about”, so a reinstall/upgrade does not ask all over again.
const LEGACY_LAST_OFFERED_KEY = 'xunji.clipboard.v1'
const MAX_CLIPBOARD_CHARS = 5000
const CHECK_DELAY_MS = 900

interface Candidate {
  url: string
  hint: string | null
}

/**
 * Take a look at the clipboard when the app opens or comes back: if it holds a web link that is not saved yet, ask whether to save it.
 *
 * It is read once and only used to decide “is this a link”. Clipboard text goes into no log and no database;
 * when the user taps save, the link enters the local database as part of the save, and the title seed is passed to the save flow in memory only.
 */
export function ClipboardPrompt({ enabled }: { enabled: boolean }) {
  const t = useT()
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
    // The save screen reached via share has its own flow; do not stack a clipboard dialog on top of it.
    if (pathnameRef.current.startsWith('/share')) return

    checkingRef.current = true
    try {
      if (!(await Clipboard.hasStringAsync())) return
      const text = (await Clipboard.getStringAsync()).trim()
      if (!text || text.length > MAX_CLIPBOARD_CHARS) return

      const url = extractHttpUrl(text)
      if (!url || !isValidHttpUrl(url)) return

      const last =
        (await AsyncStorage.getItem(LAST_OFFERED_KEY)) ??
        (await AsyncStorage.getItem(LEGACY_LAST_OFFERED_KEY))
      if (last === url) return

      if (await repo.hasDocument(url)) {
        await AsyncStorage.setItem(LAST_OFFERED_KEY, url)
        return
      }
      setCandidate({ url, hint: titleHintFrom(text, url) })
    } catch {
      // Skip silently when the clipboard is unavailable (iOS has not allowed paste, the app is in the background, system restrictions).
    } finally {
      checkingRef.current = false
    }
  }, [enabled])

  // Ask once after a cold start lands on the home screen.
  useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(() => void check(), CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, check])

  // Look again when coming back from the background: the clipboard has usually just been written by another app.
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
        toast(t('home.toast.duplicate'), {
          action: {
            label: t('home.toast.openExisting'),
            onPress: () => router.push(`/documents/${res.id}`),
          },
        })
      } else {
        toast(t('home.toast.saved'), {
          type: 'success',
          action: { label: t('common.view'), onPress: () => router.push(`/documents/${res.id}`) },
        })
        void processPendingQueue()
      }
    } catch {
      toast(t('composer.saveFailed'), { type: 'error' })
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
      title={t('clipboard.title')}
      message={message}
      confirmLabel={t('common.save')}
      cancelLabel={t('common.notNow')}
      onConfirm={() => void handleSave()}
      onCancel={handleDismiss}
    />
  )
}
