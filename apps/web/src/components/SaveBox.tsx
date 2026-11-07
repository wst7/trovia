import { useState } from 'react'
import type { FormEvent } from 'react'
import { extractHttpUrl } from '@trovia/shared'
import { PlusIcon } from './Icons'

/**
 * Save input: accepts a bare link, and also phone share text that carries a title/description.
 * onSave returns a Promise; the input is cleared on success.
 */
export function SaveBox({
  onSave,
  saving = false,
}: {
  onSave: (url: string) => Promise<void>
  saving?: boolean
}) {
  const [value, setValue] = useState('')
  const detectedUrl = extractHttpUrl(value)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!detectedUrl || saving) return
    await onSave(detectedUrl)
    setValue('')
  }

  return (
    <form className="save-box" onSubmit={submit}>
      <span className="save-label">
        <PlusIcon />
        <span className="save-label-text">收藏链接</span>
      </span>
      <input
        className="save-input"
        type="text"
        placeholder="粘贴链接或分享文字……"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="粘贴要保存的链接或分享文字"
      />
      <button className="save-submit" type="submit" disabled={!detectedUrl || saving}>
        {saving ? '保存中…' : '保存'}
      </button>
    </form>
  )
}
