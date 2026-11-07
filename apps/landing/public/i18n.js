/**
 * Bilingual copy for the landing page.
 *
 * English is looked up by the Chinese source text, so the HTML never needs
 * a key on every sentence. Adding or rewording a Chinese sentence means
 * adding one entry here; `npm run check:i18n` fails when that is forgotten.
 *
 * The tagline is excluded: app.js renders it word by word, so swapping text
 * nodes underneath it would fight the reveal animation.
 */
(function () {
  var EN = {
    '跳到正文': 'Skip to content',

    /* Navigation */
    '功能': 'Features',
    '怎么用': 'How it works',
    '常见问题': 'FAQ',
    '能读什么': 'What it reads',
    '下载': 'Get app',
    '下载 Android 版': 'Download for Android',

    /* Hero */
    '存下来的东西，': 'The things you saved,',
    '三个月后还找得回来。': 'still come back three months later.',
    'Trovia 在你手机上读正文、读截图里的字、写摘要。以后用一句你记得的描述，就能把原文找回来。':
      'Trovia reads the page on your phone, reads the words inside screenshots, and writes a summary. Months later, one sentence you still remember is enough to bring it back.',
    '源码公开在 GitHub，可以自己核对它做了什么。':
      'The source is public on GitHub, so you can check what it does yourself.',

    /* Benefits */
    '它替你做的事': 'What it does for you',
    '存的时候不用做决定': 'Nothing to decide when you save',
    '粘链接就是保存，写一句话就是搜索。只有一个输入框，不用先想清楚这算哪一类。':
      'Paste a link and it is saved. Type a sentence and it is a search. One field, and no need to know which one you meant.',
    '截图里的字也在索引里': 'Words inside screenshots get indexed',
    '公众号长图、架构图、图片笔记都会被读一遍。很多关键信息从来不在正文里。':
      'Long screenshots, architecture diagrams and image led notes all get read. A lot of what matters never reaches the text layer.',
    '旧收藏能整批搬进来': 'Your old saves move in as a batch',
    '浏览器书签、CSV、链接清单一次导入。动手前先告诉你新增多少条、跳过多少条。':
      'Browser bookmarks, a CSV or a list of links import at once. Before anything is written it tells you how many are new and how many are skipped.',
    '想走随时能走': 'Leave whenever you like',
    '整库导出成一个压缩包，另有可直接阅读的 Markdown。同步写进你自己的 WebDAV。':
      'Export the whole library as one archive, with readable Markdown alongside it. Sync writes into your own WebDAV.',

    /* How it works */
    '三步，没有第四步': 'Three steps, and no fourth',
    '交给它': 'Hand it over',
    '粘贴链接，或者从别的应用直接分享过来。标题、分类、标签都不用填。':
      'Paste a link, or share one in from another app. No title, no folder, no tag.',
    '它在手机上读完': 'It reads on the phone',
    '抓正文、读图里的字、写摘要和关键词，建一份本地索引。失败的条目会说明原因。':
      'The text is fetched, the words inside images are read, a summary and keywords are written, and a local index is built. Failures say why.',
    '用一句话找回来': 'Find it with one sentence',
    '描述你还记得的部分，它给你原文，并说明是在哪儿匹配上的。':
      'Describe what you still remember. You get the text back, with a note on where it matched.',

    /* Screens */
    '界面长什么样': 'What it looks like',
    '保存完就不用管了。标题、摘要和状态会自己长出来。':
      'Saving is the whole job. Titles, summaries and status grow on their own.',
    '正文和它自己的图片一起存下来，图片上的字也进索引。':
      'The text is kept with the images that belong to it, and the words on them go into the index.',

    /* What it reads */
    '能读哪些页面': 'What it can read',
    '哪些读得全、哪些只能留链接，如实写在这里。':
      'What it reads in full and what it can only keep as a link, stated plainly.',
    '读得全': 'Reads in full',
    '微信公众号、掘金、少数派、CSDN、V2EX、GitHub、维基百科、简书，以及大多数个人博客和文档站。':
      'WeChat articles, Juejin, SSPAI, CSDN, V2EX, GitHub, Wikipedia, Jianshu, and most personal blogs and documentation sites.',
    '只留链接': 'Link only',
    '知乎、Medium、豆瓣、36 氪这类有登录墙或人机验证的站点。它会直接说需要验证或登录，不假装存成功。':
      'Zhihu, Medium, Douban and 36Kr sit behind a sign in or a bot check. It says verification or sign in is needed instead of pretending the save worked.',
    '图片里的字': 'Words in images',
    '正文图片都会试一遍，认不出的跳过，不影响正文。':
      'Every image in the text is attempted. Ones it cannot read are skipped and the text is unaffected.',
    '解析失败': 'Failed saves',
    '原始链接一直保留，随时能打开原文，也能稍后重试。':
      'The original link is always kept, so you can open it now or retry later.',

    /* Promises */
    '先装，用不惯就走': 'Install it, and leave if it does not fit',
    '免费，不设功能墙': 'Free, with no feature gates',
    '解析、读图、按意思找回都免费。付费只覆盖你不想自己准备模型的那一种情况。':
      'Fetching, reading images and finding by meaning are free. Paying only covers the case where you would rather not set up a model yourself.',
    '不用注册': 'No account needed',
    '没有登录、没有手机号。数据在这台设备上，不在我们的服务器上。':
      'No sign in, no phone number. The data lives on this device, not on a server of ours.',
    '随时整库导出': 'Export the whole library',
    '一个压缩包带走全部内容，另附一份能直接读的 Markdown。':
      'One archive carries everything, with readable Markdown alongside it.',
    '删除就是删除': 'Delete means delete',
    '删掉后正文和图片一起清掉，搜索不会再有，其它设备同样消失。':
      'The text and images go with it, search stops returning it, and other devices drop it too.',

    /* FAQ */
    '要付费吗？': 'Is there a price?',
    '解析、读图里的字、按时间与意思找回都免费，不设功能墙。付费只出现在一种情况：你不想自己准备模型，由我们代付。':
      'Fetching, reading words inside images, and finding by time or meaning are free, with no feature gates. Paying only ever means we cover a model for you when you would rather not set one up.',
    '需要注册账号吗？': 'Do I need an account?',
    '不需要。没有登录、没有手机号、没有邮箱，打开就能用。':
      'No. No sign in, no phone number, no email. It works the moment you open it.',
    '我的收藏会被上传吗？': 'Is my library uploaded?',
    '不会。收藏、正文和图片都留在这台设备上。需要多端时，写入的是你自己的 WebDAV 云盘，密码只进系统钥匙串。':
      'No. Saves, text and images stay on this device. For more than one device they are written to your own WebDAV drive, and the password goes only into the system keychain.',
    '支持 iPhone 吗？': 'Is there an iPhone version?',
    '目前只有 Android 安装包。iOS 没有可直接下载的构建，需要自己用 Xcode 或 EAS 编译。':
      'Android only for now. There is no downloadable iOS build, and compiling it takes Xcode or EAS.',
    '知乎、Medium 为什么存不全？': 'Why do some sites come up short?',
    '这些站点有登录墙或人机验证，端侧拿不到正文。Trovia 只留链接和标题，并明确告诉你原因。它不绕过登录、付费墙或任何访问限制。':
      'Those sites sit behind a sign in or a bot check, so the text cannot be fetched on the device. Trovia keeps the link and title and tells you why. It does not go around logins, paywalls or access limits.',
    '不接大模型能用吗？': 'Does it work without a model?',
    '能。摘要和关键词可以离线抽取，功能一样完整。接一个 OpenAI 兼容的服务只是让摘要更顺，并能从一句话里读出你的意图。':
      'Yes. Summaries and keywords can be extracted offline and nothing is missing. Connecting an OpenAI compatible service only makes summaries smoother and lets it read your intent from a sentence.',
    '换手机怎么迁移？': 'What about moving to a new phone?',
    '导出备份压缩包拷过去再导入，或者事先用 WebDAV 同步。两条路都能逐字段还原。':
      'Export the backup archive and import it on the new phone, or sync through WebDAV first. Either path restores every field.',
    '两台设备同时改会丢吗？': 'If two devices edit the same item, is it lost?',
    '不会。新的那份占主位，另一份留成冲突副本，两份内容都在。':
      'No. The newer copy takes the main slot and the other is kept as a conflict copy. Both survive.',

    /* Closing */
    '存下第一个链接': 'Save your first link',
    '粘贴任意链接，几秒后它就被整理好了。之后想找它，只需要一句描述。':
      'Paste any link and it is organised within seconds. Finding it later takes one sentence.',
    '免费，不用注册，数据留在本机。': 'Free, no account, and the data stays on the device.',

    /* Footer */
    '源码': 'Source',
    '隐私': 'Privacy',
    '许可': 'License',
  }

  var META = {
    zh: {
      title: 'Trovia — 存下来的东西，三个月后还找得回来',
      description:
        'Trovia 在手机上读正文、读截图里的字、写摘要。以后用一句你记得的描述，就能把存过的内容找回来。免费，数据只留在本机。',
    },
    en: {
      title: 'Trovia — save anything, find it months later',
      description:
        'Trovia reads the page on your phone, reads the words inside screenshots, and writes a summary. Months later one sentence you remember is enough to bring it back. Free, and the library stays on your device.',
    },
  }

  var ORIGINAL = new WeakMap()

  function isSkipped(node) {
    var el = node.parentElement
    return !!(el && el.closest('[data-i18n-skip]'))
  }

  function eachTextNode(fn) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
    var node
    while ((node = walker.nextNode())) {
      if (isSkipped(node)) continue
      fn(node)
    }
  }

  function captureOriginal() {
    eachTextNode(function (node) {
      if (!ORIGINAL.has(node)) ORIGINAL.set(node, node.nodeValue)
    })
  }

  function restoreOriginal() {
    eachTextNode(function (node) {
      var raw = ORIGINAL.get(node)
      if (raw !== undefined) node.nodeValue = raw
    })
  }

  function walk(dict) {
    eachTextNode(function (node) {
      var raw = node.nodeValue
      var key = raw.replace(/\s+/g, ' ').trim()
      if (!key || !dict[key]) return
      var lead = raw.match(/^\s*/)[0]
      var trail = raw.match(/\s*$/)[0]
      node.nodeValue = lead + dict[key] + trail
    })
  }

  function setMeta(meta) {
    ;[
      ['meta[name="description"]', meta.description],
      ['meta[property="og:title"]', meta.title],
      ['meta[property="og:description"]', meta.description],
      ['meta[name="twitter:title"]', meta.title],
      ['meta[name="twitter:description"]', meta.description],
    ].forEach(function (pair) {
      var el = document.querySelector(pair[0])
      if (el) el.setAttribute('content', pair[1])
    })
  }

  function setSwitch(lang) {
    document.querySelectorAll('.lang button').forEach(function (button) {
      var active = button.getAttribute('data-lang') === lang
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  }

  function readStored() {
    try {
      return localStorage.getItem('trovia.lang')
    } catch (error) {
      return null
    }
  }

  function store(lang) {
    try {
      localStorage.setItem('trovia.lang', lang)
    } catch (error) {
      /* Private mode may refuse the write. The switch still works this visit. */
    }
  }

  function detect() {
    var query = new URLSearchParams(window.location.search).get('lang')
    if (query === 'zh' || query === 'en') return query
    var stored = readStored()
    if (stored === 'zh' || stored === 'en') return stored
    var nav = (navigator.language || 'zh').toLowerCase()
    return nav.indexOf('zh') === 0 ? 'zh' : 'en'
  }

  function apply(lang) {
    var isEn = lang === 'en'
    var meta = META[isEn ? 'en' : 'zh']

    // Put the Chinese back first, then overwrite for English. Running this
    // on every switch keeps both directions idempotent.
    restoreOriginal()

    document.documentElement.lang = isEn ? 'en' : 'zh-CN'
    document.title = meta.title
    setMeta(meta)
    setSwitch(isEn ? 'en' : 'zh')

    if (isEn) walk(EN)

    document.querySelectorAll('img[data-src-en]').forEach(function (img) {
      var zhSrc = img.getAttribute('data-src-zh') || img.getAttribute('src')
      var zhAlt = img.getAttribute('data-alt-zh') || img.getAttribute('alt')
      if (isEn) {
        img.setAttribute('src', img.getAttribute('data-src-en'))
        img.setAttribute('alt', img.getAttribute('data-alt-en') || '')
      } else {
        img.setAttribute('src', zhSrc)
        img.setAttribute('alt', zhAlt || '')
      }
    })

    document.dispatchEvent(new CustomEvent('trovia:lang', { detail: { lang: isEn ? 'en' : 'zh' } }))
  }

  function rememberImages() {
    document.querySelectorAll('img[data-src-en]').forEach(function (img) {
      if (!img.getAttribute('data-src-zh')) img.setAttribute('data-src-zh', img.getAttribute('src'))
      if (!img.getAttribute('data-alt-zh')) img.setAttribute('data-alt-zh', img.getAttribute('alt'))
    })
  }

  function start() {
    rememberImages()
    captureOriginal()
    var lang = detect()
    document.querySelectorAll('.lang button').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-lang')
        store(next)
        apply(next)
      })
    })
    apply(lang)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
