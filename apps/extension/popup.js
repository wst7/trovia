const el = (id) => document.getElementById(id)

const MESSAGES = {
  saved: '已存入。手机下次同步就能看到。',
  queued: '没连上云盘，已排队，稍后自动重试。',
  'not-configured': '先填 WebDAV 地址和账号。',
  'not-a-page': '这个页面不能保存（chrome:// 之类的地址）。',
}

function showStatus(text, tone = 'muted') {
  const node = el('status')
  node.textContent = text
  node.dataset.tone = tone
}

async function loadQueueCount() {
  const stored = await chrome.storage.local.get('trovia.queue')
  const count = Array.isArray(stored['trovia.queue']) ? stored['trovia.queue'].length : 0
  el('queue').textContent = count > 0 ? `${count} 条待发送` : ''
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url ?? ''
  const saveable = /^https?:\/\//i.test(url)

  el('title').textContent = tab?.title || url || '没有可保存的页面'
  el('host').textContent = saveable ? new URL(url).host : ''
  el('save').disabled = !saveable

  const stored = await chrome.storage.local.get('trovia.config')
  const configured = Boolean(stored['trovia.config']?.base)
  if (!configured) showStatus(MESSAGES['not-configured'], 'error')

  el('settings').addEventListener('click', (event) => {
    event.preventDefault()
    chrome.runtime.openOptionsPage()
  })

  el('save').addEventListener('click', async () => {
    const button = el('save')
    button.dataset.busy = 'true'
    button.disabled = true
    showStatus('正在写入云盘…')

    const result = await chrome.runtime.sendMessage({
      type: 'save-url',
      payload: { url, title: tab?.title },
    })

    button.dataset.busy = 'false'
    button.disabled = false

    if (result?.ok) {
      showStatus(MESSAGES.saved)
      button.textContent = '已保存'
      loadQueueCount()
      return
    }
    const reason = result?.reason ?? 'queued'
    showStatus(MESSAGES[reason] ?? `保存失败：${reason}`, 'error')
    loadQueueCount()
  })

  loadQueueCount()
}

main()
