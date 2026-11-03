import { useState } from 'react'
import type { FormEvent } from 'react'
import { extractHttpUrl } from '@trovia/shared'
import { PlusIcon } from './Icons'

/**
 * 保存输入框：接受纯链接，也接受带标题/描述的手机分享文字。
 * onSave 返回 Promise，成功后清空输入。
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
