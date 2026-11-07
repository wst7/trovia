/**
 * 后台：右键菜单、快捷键、保存与重试队列。
 *
 * MV3 的 service worker 随时会被回收，所以这里不留内存状态：
 * 待发队列在 chrome.storage.local，重试用 alarms 拉起，冷启动也能接着跑。
 */
import { buildRecord } from './src/record.js'
import { check, getRecord, putRecord } from './src/webdav.js'

const CONFIG_KEY = 'trovia.config'
const QUEUE_KEY = 'trovia.queue'
const LOG_KEY = 'trovia.log'
const RETRY_ALARM = 'trovia-retry'

async function readConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY)
  const config = stored[CONFIG_KEY]
  if (!config?.base || !config?.user || !config?.password) return null
  return { folder: 'trovia', ...config }
}

async function readQueue() {
  const stored = await chrome.storage.local.get(QUEUE_KEY)
  return Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : []
}

async function writeQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue })
}

async function log(line) {
  const stored = await chrome.storage.local.get(LOG_KEY)
  const lines = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : []
  lines.unshift(`${new Date().toISOString()} ${line}`)
  await chrome.storage.local.set({ [LOG_KEY]: lines.slice(0, 20) })
}

/** 存一条链接；失败就进队列，返回给弹窗的永远是「已排队」或「已保存」。 */
export async function saveUrl({ url, title }) {
  const config = await readConfig()
  if (!config) return { ok: false, reason: 'not-configured' }

  const record = buildRecord({ url, title })
  if (!record) return { ok: false, reason: 'not-a-page' }

  try {
    // 同一个链接再存一次：沿用云端的 rev，覆盖自己而不是造出第二条。
    const existing = await getRecord(config, record.id).catch(() => null)
    if (existing?.rev) {
      record.rev = Number(existing.rev) + 1
      record.payload.saved_at = existing.payload?.saved_at ?? record.payload.saved_at
    }
    await putRecord(config, record)
    await log(`saved ${record.id} ${record.payload.url}`)
    return { ok: true, id: record.id }
  } catch (error) {
    const queue = await readQueue()
    queue.push({ record, at: Date.now() })
    await writeQueue(queue)
    await log(`queued ${record.id} (${error?.message ?? error})`)
    await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 5 })
    return { ok: false, reason: 'queued', id: record.id }
  }
}

/** 队列重试：能发多少发多少，发不出去的留在队列里等下一次。 */
export async function flushQueue() {
  const config = await readConfig()
  if (!config) return { sent: 0, left: (await readQueue()).length }

  const queue = await readQueue()
  const left = []
  let sent = 0
  for (const item of queue) {
    try {
      await putRecord(config, item.record)
      sent += 1
    } catch (error) {
      left.push(item)
      await log(`retry failed ${item.record.id} (${error?.message ?? error})`)
    }
  }
  await writeQueue(left)
  if (left.length > 0) await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 5 })
  return { sent, left: left.length }
}

/** 连接测试，设置页和弹窗都用它。 */
export async function testConnection(config) {
  const started = Date.now()
  const result = await check(config)
  return { ...result, ms: Date.now() - started }
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function saveActiveTab() {
  const tab = await currentTab()
  if (!tab?.url) return { ok: false, reason: 'not-a-page' }
  return saveUrl({ url: tab.url, title: tab.title })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-page', title: '存进 Trovia', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'save-link', title: '存这个链接进 Trovia', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'save-selection', title: '存这段选中文字所在的页', contexts: ['selection'] })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-link' && info.linkUrl) {
    saveUrl({ url: info.linkUrl, title: info.selectionText ?? tab?.title })
    return
  }
  if (tab?.url) saveUrl({ url: tab.url, title: tab.title })
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-page') saveActiveTab()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) flushQueue()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'save-active-tab') {
    saveActiveTab().then(sendResponse)
    return true
  }
  if (message?.type === 'save-url') {
    saveUrl(message.payload).then(sendResponse)
    return true
  }
  if (message?.type === 'flush') {
    flushQueue().then(sendResponse)
    return true
  }
  if (message?.type === 'test') {
    testConnection(message.payload).then(sendResponse)
    return true
  }
  return false
})
