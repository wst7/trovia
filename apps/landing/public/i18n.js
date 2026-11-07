/**
 * 落地页的中英切换。
 *
 * 不引入框架：整页都是静态文字，按原文逐句替换即可。英文按「中文原文」查表，
 * 这样 HTML 里不用为每一句挂 key，改文案时改一处就行。
 *
 * 改文案时只有一条规矩：HTML 里新增或改写一句中文，就要在这个表里补一条，
 * 否则英文模式下那句会保持中文。tools/check-i18n.mjs 会检查覆盖率。
 *
 * 判定顺序：localStorage 里的选择 > 浏览器语言 > 中文。
 * 切到英文时同时改 <html lang>、标题和分享用的 meta，避免分享出去还是中文。
 */
(function () {
  var EN = {
    '下载 App': 'Get the app',

    '你不需要记住收藏了什么，': "You don't need to remember what you saved,",
    '只需要记住你想找什么。': 'only what you were looking for.',
    '看到有价值的内容，把链接交给 Trovia。它在手机上读正文、读图里的字、写摘要；几个月后你只要描述还记得的内容，就能把它找回来——不用分类，不用打标签。':
      'Hand Trovia the link to something worth keeping. It reads the page on your phone, reads the words inside images, writes a summary — so months later a rough description is enough to bring it back. No folders, no tags.',
    '下载 Android App': 'Download for Android',
    '永久免费，不设功能墙': 'Free, no feature gates',
    '不用注册，打开就能用': 'No account, no sign-up',
    '收藏只存在你的手机上': 'Kept on your phone only',

    '首页只有一个输入框：看得出是': 'One field on the home screen: if it looks like a ',
    '链接': 'link',
    '就保存，看不出就': ', it saves; if not, it ',
    '当成一句话去找': 'searches for the sentence',
    '。': '.',

    '怎么用': 'How it works',
    '三步，没有第四步。': 'Three steps, and no fourth.',
    '保存': 'Save',
    '粘贴文章、视频或网站链接，或从别的应用直接分享过来。不用填标题，不用分类，不用打标签。':
      'Paste a link to an article, a video or a site, or share it straight from another app. No title, no folder, no tag.',
    '整理': 'Read',
    '在手机上解析正文、读图里的文字、生成摘要与关键词、建立本地索引。页面上能看到处理状态，失败的条目会说明原因。':
      'On the phone it extracts the text, reads words inside images, writes a summary and keywords, and builds a local index. You can watch each item; failures say why.',
    '找回': 'Find',
    '用一句自然语言描述你记得的大概内容，得到原文，以及「为什么找到它」。':
      'Describe what you remember in one sentence, and get the original back — with a note on why it matched.',
    '搜「AMD」命中一篇早报——这个词只出现在': 'Searching “AMD” finds a morning digest — the word only appears',
    '正文的速览列表': 'in the body list',
    '里，标题里没有；结果会说明它命中了哪儿。': ', never in the title, and the result says where it matched.',

    '它替你做的事': 'What it does for you',
    '一个框，两种用法': 'One field, two uses',
    '保存和找回本来就是一回事。粘的是链接就存下来，写的是一句话就去检索——不用在脑子里先想清楚这次是哪种。':
      'Saving and finding are the same act. Paste a link and it is saved; type a sentence and it is a search — you never have to decide which one you meant.',
    '截图里的字也搜得到': 'Words inside screenshots are searchable',
    '公众号长截图、技术文章里的架构图、小红书的图片笔记，都会读一遍再进索引。很多内容根本不在正文里。':
      'Long screenshots from WeChat, architecture diagrams inside technical posts, image-first notes — all of them are read and indexed. A lot of what matters never reaches the text layer.',
    '旧收藏搬得进来': 'Your old saves move in',
    '浏览器导出的书签、CSV、链接清单一键导入；重复的自动跳过，先告诉你「会新增多少条」再动手。':
      'Bookmarks exported from a browser, a CSV, or a list of links import in one go. Duplicates are skipped, and you see how many are new before anything is written.',
    '随时能完整带走': 'Take everything with you',
    '整库导出成一个 .zip：可以逐字段还原的备份，外加一份能直接读的 Markdown。不存在我们服务器上。':
      'Export the whole library as one .zip — a backup that restores field for field, plus readable Markdown. It was never on a server of ours.',
    '还有很多小事不用你操心': 'The small things are handled too',
    '怎么读': 'Reading',
    '正文用宋体排版，长文读起来像纸页。': 'Article text is set in a serif face; long pieces read like a page.',
    '怎么删': 'Deleting',
    '收藏列表支持左滑删除，也能长按进多选批量删除；正文和图片一起清掉，搜索也不会再出现。':
      'Swipe a row to delete it, or long-press to select several. The text and images go with it, and search will not bring it back.',
    '怎么更新': 'Updating',
    '应用内检查更新，点一下才下载；只改界面的小版本下完提示重启即可。':
      'Trovia checks for a newer build in-app and only downloads when you tap. Interface-only fixes restart in place.',

    '存下来就是这样': 'What a save looks like',
    '保存就结束了。列表会自己长出标题、摘要和状态，不需要你维护。':
      'Saving is the whole job. Titles, summaries and status appear on their own; nothing to maintain.',

    '图片里的字也读得出来': 'It reads the text inside images',
    '很多内容根本不在正文里：公众号的长截图、技术文章里的架构图和思维导图、小红书的图片笔记。Trovia 会把正文里的图片一起存下来，用端侧 OCR 把上面的文字读出来，接在原文后面一起索引——所以那些字也能被搜到。':
      'A lot of what matters never reaches the text layer: long screenshots from WeChat, architecture diagrams and mind maps inside technical posts, image-first notes. Trovia keeps the images in an article, reads them with on-device OCR and indexes what it finds — so those words are searchable too.',
    '识别在你自己的手机上完成：图片不经过任何服务器，读出来的文字只写进本机数据库。':
      'Recognition runs on your own phone. Images never leave the device, and the text goes only into the local database.',
    '正文里的图片会一起存下来，图上的文字进索引。':
      'Images in an article are kept with it, and the words on them go into the index.',

    '能读哪些页面': 'What it can read',
    '哪些能读、哪些只能留链接，如实写在下面——不假装全都成功。':
      'Which pages it reads in full and which ones it can only keep as a link — stated plainly, without pretending every save worked.',
    '正常解析': 'Reads in full',
    '微信公众号、掘金、少数派、CSDN、V2EX、GitHub、维基百科、简书，以及大多数个人博客和文档站。':
      'WeChat articles, Juejin, SSPAI, CSDN, V2EX, GitHub, Wikipedia, Jianshu, and most personal blogs and documentation sites.',
    '只能拿到链接': 'Link only',
    '知乎、Medium、豆瓣、36 氪这类有登录墙或人机验证的站点，端侧抓不到正文；Trovia 会明确告诉你「需要验证或登录」，而不是假装保存成功。':
      'Sites behind a sign-in or a bot check — Zhihu, Medium, Douban, 36Kr — cannot be fetched on device. Trovia says “needs verification or sign-in” instead of pretending the save worked.',
    '图片内容': 'Images',
    '正文里的图片都会尝试识别，认不出的跳过，不影响正文。':
      'Every image in an article is attempted; ones it cannot read are skipped, and the text is unaffected.',
    '解析失败': 'Failed saves',
    '原始链接始终保留，可以随时打开原文，也可以稍后重新解析。':
      'The original link is always kept — open it any time, or try parsing again later.',

    '同步写进你自己的云盘': 'Sync into your own cloud',
    '没有账号，也没有中间服务器。填一个 WebDAV 地址，内容就在你的手机和你的网盘之间直接走—— 坚果云、群晖、Nextcloud 都属于这一类，我们只是读写你给的那个目录。':
      'No account and no server in the middle. Point it at a WebDAV address and content moves directly between your phone and your own drive — Nutstore, Synology and Nextcloud all work. We only read and write the folder you give us.',
    '要准备什么': 'What you need',
    '服务器地址、用户名、应用密码。坚果云在「账户信息 → 安全选项 → 添加应用」里生成应用密码，而不是用登录密码。':
      'Server address, username, app password. In Nutstore, generate an app password under Account info → Security → Add app; do not use your login password.',
    '什么时候同步': 'When it syncs',
    '打开应用时自动跑一轮（最快五分钟一次），也可以手动点「立即同步」；失败不会弹窗打断你。':
      'A round runs when the app opens, at most once every five minutes; or tap Sync now. Failures do not interrupt you with a dialog.',
    '两台都改过': 'Both devices edited',
    '新的那份占主位，另一份留成「（冲突副本）」，两份内容都在，不会被悄悄覆盖。':
      'The newer copy takes the main slot and the other is kept as a “(conflict copy)”. Both survive; nothing is silently overwritten.',
    '删除会一起同步：删掉的那条在其它设备上也会消失，不会下次同步又冒回来。':
      'Deletes sync too: an item removed here disappears elsewhere and does not come back on the next sync.',
    '填一次地址和应用密码就够了：地址、账号都留在本机，密码只进系统钥匙串。':
      'Fill in the address and app password once. The address and username stay on the device; the password goes only into the system keychain.',

    '你可能想问的': 'Questions you might have',
    '收费吗？': 'Does it cost anything?',
    '解析、读图里的字、按时间与意思找回，这些能力永久免费，不设功能墙。付费只会出现在一件事上：你不想自己准备模型时，由我们代付。':
      'Fetching, reading words inside images, finding by time and meaning — all free, with no feature gates. Paying only ever covers one thing: a model paid for on your behalf, when you would rather not set one up yourself.',
    '要注册账号吗？': 'Do I need an account?',
    '不需要。打开就能用，没有登录、没有手机号、没有邮箱。':
      'No. Open it and use it — no sign-in, no phone number, no email.',
    '我的收藏会被上传吗？': 'Is my library uploaded?',
    '不会。收藏、正文与图片都保存在这台设备上，默认不上传任何服务器。需要多端时，写入的是你自己的 WebDAV 云盘。':
      'No. Saves, article text and images stay on this device and are not sent to any server by default. For multiple devices, they go to your own WebDAV drive.',
    '支持 iPhone 吗？': 'Is there an iPhone version?',
    '目前只有 Android 安装包。iPhone 暂时没有可直接下载的构建，需要自己用 Xcode 或 EAS 编译。':
      'Android only for now. There is no downloadable iOS build; compiling it needs Xcode or EAS.',
    '知乎、Medium 为什么存不全？': 'Why do Zhihu and Medium saves come up short?',
    '这些站点有登录墙或人机验证，端侧拿不到正文，Trovia 只留下链接和标题，并明确告诉你原因。它不绕过登录、付费墙或任何访问限制。':
      'Those sites sit behind a sign-in or a bot check, so the text cannot be fetched on device. Trovia keeps the link and title and says why. It does not go around logins, paywalls or any access restriction.',
    '不接大模型能用吗？': 'Does it work without a model?',
    '能。摘要与关键词可以离线抽取，功能一样完整。接一个 OpenAI 兼容的服务只是让摘要更顺，并且能用一句话描述去理解你的意图。':
      'Yes. Summaries and keywords can be extracted offline and nothing is missing. Connecting an OpenAI-compatible service only makes summaries smoother and lets it read your intent from a sentence.',
    '换手机了怎么办？': 'What if I change phones?',
    '导出那个 .zip 拷过去再导入，或者事先用 WebDAV 同步。两条路都能逐字段还原，不是只导出一堆链接。':
      'Copy the .zip over and import it, or sync through WebDAV beforehand. Either path restores field for field — not just a pile of links.',
    '两台设备都改过同一条，会丢吗？': 'If both devices edited the same item, is it lost?',
    '不会。新的那份占主位，另一份留成「（冲突副本）」，两份内容都在。':
      'No. The newer copy takes the main slot and the other is kept as a conflict copy. Both survive.',

    '我们的四条承诺': 'Four promises',
    '这个产品很小，所以不想把话说满。只有四件事，写在这里当承诺看。':
      'This is a small product, so we would rather not overstate it. Four things, written here as promises.',
    '数据始终在你自己手里': 'Your data stays yours',
    '收藏、正文与图片都保存在这台设备上；要同步，就写进你自己的云盘。任何时候都能完整导出，随时带走。':
      'Saves, text and images live on this device; for sync they go into your own drive. Everything can be exported in full at any time.',
    '不设功能墙': 'No feature gates',
    '解析、读图里的字、按时间与意思找回——这些能力永远免费。':
      'Fetching, reading words inside images, finding by time and meaning — always free.',
    '不绕过任何限制': 'No bypassing restrictions',
    '不绕过登录、付费墙或访问限制；读不到就直说，不假装保存成功。':
      'No going around logins, paywalls or access limits. If it cannot read a page, it says so.',
    '删除就是删除': 'Delete means delete',
    '删除后正文和图片一起清掉，搜索也不会再出现，同步到其它设备同样消失。':
      'Deleting removes the text and images, search will not surface the item again, and it disappears from other devices too.',
    '设置里能看清数据存在哪、还剩多少空间。':
      'Settings show where your data lives and how much space is left.',

    '存下第一个链接': 'Save your first link',
    '粘贴任意文章链接，几秒后它就会被整理好。之后想找它，只需要一句描述。':
      'Paste any article link and it is organised within seconds. Getting it back later takes one sentence.',
    '数据保存在本机，不需要注册；多端同步走你自己的 WebDAV。':
      'Data stays on the device; no sign-up. Sync runs through your own WebDAV.',
  }

  var META = {
    zh: {
      title: 'Trovia — 存下任何链接，凭记忆找回',
      description:
        'Trovia 是个人链接收藏与智能找回工具：粘贴链接自动抓取正文、图片与摘要，截图里的文字也会被端侧 OCR 读出来；之后用一句自然语言描述就能从自己的收藏里找回原文。免费，数据只保存在你自己的手机上。',
      alt: 'Trovia 首页',
    },
    en: {
      title: 'Trovia — save any link, find it by memory',
      description:
        'Trovia keeps the links worth keeping: it reads the page on your phone, saves the text and images, reads the words inside screenshots with on-device OCR, and later finds it again from a single rough description. Free, and the library stays on your own phone.',
      alt: 'Trovia home screen',
    },
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
      /* 隐私模式下写不进去也无妨，本次仍然生效。 */
    }
  }

  function detect() {
    // ?lang=en 优先：分享出去的链接能直接落到对应语言。
    var query = new URLSearchParams(window.location.search).get('lang')
    if (query === 'zh' || query === 'en') return query
    var stored = readStored()
    if (stored === 'zh' || stored === 'en') return stored
    var nav = (navigator.language || 'zh').toLowerCase()
    return nav.indexOf('zh') === 0 ? 'zh' : 'en'
  }

  /** 只替换纯文本节点：元素里的 <strong>、<code> 结构原样保留。 */
  function walk(root, dict) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    var node
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue
      // 原文里有换行和缩进（HTML 排版留下的），查表前先压成一个空格。
      var key = raw.replace(/\s+/g, ' ').trim()
      if (!key || !dict[key]) continue
      var lead = raw.match(/^\s*/)[0]
      var trail = raw.match(/\s*$/)[0]
      node.nodeValue = lead + dict[key] + trail
    }
  }

  /**
   * 每个文本节点的中文原文。切回中文时直接按节点还原——
   * 不能按文本查表：那时候文本已经变成英文，中文键查不到了。
   */
  var ORIGINAL = new WeakMap()

  function captureOriginal() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
    var node
    while ((node = walker.nextNode())) {
      if (!ORIGINAL.has(node)) ORIGINAL.set(node, node.nodeValue)
    }
  }

  function restoreOriginal() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
    var node
    while ((node = walker.nextNode())) {
      var raw = ORIGINAL.get(node)
      if (raw !== undefined) node.nodeValue = raw
    }
  }

  function apply(lang) {
    var isEn = lang === 'en'
    var meta = META[isEn ? 'en' : 'zh']

    // 先按节点把中文原文放回去，再决定要不要覆盖成英文。
    // 这样中英来回切换任意次都是幂等的。
    restoreOriginal()

    document.documentElement.lang = isEn ? 'en' : 'zh-CN'
    document.title = meta.title
    setMeta(meta)
    setSwitch(isEn ? 'en' : 'zh')

    if (isEn) walk(document.body, EN)

    // 截图里的界面也是中文的，所以英文版换一套英文界面的图。
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

    document.querySelectorAll('[data-hide-en]').forEach(function (node) {
      node.hidden = isEn
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
    document.querySelectorAll('.lang-switch button').forEach(function (button) {
      var active = button.getAttribute('data-lang') === lang
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  }

  /** 第一次切到英文前，把当前中文记下来，切回来时按原样还原。 */
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
    document.querySelectorAll('.lang-switch button').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-lang')
        store(next)
        apply(next)
      })
    })
    if (lang === 'en') apply('en')
    else apply('zh')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
