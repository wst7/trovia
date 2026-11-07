const el = (id) => document.getElementById(id)

const KEY = 'trovia.config'

function status(text, tone = 'muted') {
  const node = el('status')
  node.textContent = text
  node.dataset.tone = tone
}

function readForm() {
  return {
    base: el('base').value.trim().replace(/\/+$/, ''),
    user: el('user').value.trim(),
    password: el('password').value,
    folder: el('folder').value.trim().replace(/^\/+|\/+$/g, '') || 'trovia',
  }
}

/** 需要目标域的主机权限，否则 service worker 里的 fetch 会被拦。 */
async function ensureHostPermission(base) {
  try {
    const origin = new URL(base).origin + '/*'
    const already = await chrome.permissions.contains({ origins: [origin] })
    if (already) return true
    return await chrome.permissions.request({ origins: [origin] })
  } catch {
    return false
  }
}

async function load() {
  const stored = await chrome.storage.local.get(KEY)
  const config = stored[KEY]
  if (!config) return
  el('base').value = config.base ?? ''
  el('user').value = config.user ?? ''
  el('password').value = config.password ?? ''
  el('folder').value = config.folder ?? 'trovia'
  status('已保存。')
}

el('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const config = readForm()
  const granted = await ensureHostPermission(config.base)
  if (!granted) {
    status('没拿到这个地址的访问权限，保存会被浏览器拦下。', 'error')
    return
  }
  await chrome.storage.local.set({ [KEY]: config })
  status('已保存，可以回去点保存了。')
})

el('test').addEventListener('click', async () => {
  const config = readForm()
  if (!config.base || !config.user || !config.password) {
    status('三样都填了才能测。', 'error')
    return
  }
  const granted = await ensureHostPermission(config.base)
  if (!granted) {
    status('没拿到这个地址的访问权限。', 'error')
    return
  }
  status('正在连…')
  const result = await chrome.runtime.sendMessage({ type: 'test', payload: config })
  if (result?.ok) {
    status(`连上了，${result.ms} ms。`, 'ok')
    return
  }
  const reasons = {
    unauthorized: '账号或应用密码不对。',
    'not-found': '地址不对，或者这个目录不存在。',
  }
  status(reasons[result?.reason] ?? `连不上（${result?.reason ?? 'unknown'}）。`, 'error')
})

load()
