/**
 * 落地页的中英切换。
 *
 * 不引入框架：整页都是静态文字，按原文逐句替换即可。英文按「中文原文」查表，
 * 这样 HTML 里不用为每一句挂 key，改文案时改一处就行。
 *
 * 判定顺序：localStorage 里的选择 > 浏览器语言 > 中文。
 * 切到英文时同时改 <html lang>、标题和分享用的 meta，避免分享出去还是中文。
 */
(function () {
  var EN = {
    'Trovia · 寻迹': 'Trovia',
    '下载 App': 'Get the app',

    '你不需要记住收藏了什么，': "You don't need to remember what you saved,",
    '只需要记住你想找什么。': 'only what you were looking for.',
    '看到有价值的内容，把链接交给 Trovia。它在手机上抓取正文、读图里的文字、写摘要、建立索引；几个月后你只要描述还记得的内容，就能把它找回来——不用分类，不用打标签。':
      'Hand Trovia the link to something worth keeping. It reads the page on your phone, reads the text inside screenshots, writes a summary and builds an index — so months later a rough description is enough to get it back. No folders, no tags.',
    '下载 Android App': 'Download for Android',
    '不用注册，打开就能用': 'No account, no sign-up',
    '收藏只存在你的手机上': 'Kept on your phone only',
    '截图里的字也能搜到': 'Text inside screenshots is searchable',

    '首页只有一个输入框：看得出是': 'One field on the home screen: if it looks like a ',
    '链接': 'link',
    '就保存，看不出就': ', it saves; if not, it ',
    '当成一句话去找': 'searches for the sentence',

    '一个框，两种用法': 'One field, two uses',
    '保存和找回本来就是一回事：你想留住某个东西，和你想找回某个东西。所以不需要两个入口。':
      'Saving and finding are the same act: wanting to keep something, and wanting it back. Two entry points would be one too many.',
    '粘的是链接': 'You pasted a link',
    '直接保存。抓正文、存下正文里的图片、写摘要与关键词，再建立本地索引。':
      'It is saved. Trovia fetches the text, keeps the images that belong to it, writes a summary and keywords, then indexes it locally.',
    '写的是描述': 'You wrote a description',
    '当成一次检索。用你记得的任意细节——主题、某句话、作者、来源——去匹配已经存下的内容。':
      'It is treated as a search. Any detail you remember — topic, a phrase, the author, where it came from — is matched against what you have already saved.',
    '已经存了一堆': 'You already have a pile',
    '浏览器导出的书签、CSV、链接清单都能一次搬进来；重复的自动跳过，先给你看清楚会新增多少条再动手。':
      'Bookmarks exported from a browser, a CSV, or a list of links can all move in at once. Duplicates are skipped, and you see how many are new before anything is written.',
    '想换个地方': 'You want to leave',
    '整库导出成 JSON 和 Markdown，正文、图片路径、时间都在里面，不留在任何服务器上。':
      'Export the whole library as JSON and Markdown — text, image paths and dates included. It was never on a server of ours.',
    '搜「延时队列」命中一篇讲写作的长文——这个词只出现在文章里的':
      'Searching for "delayed queue" found a long essay about writing — the phrase only appears on ',
    '一张思维导图截图上': 'a mind-map screenshot',
    '，正文没有它。': ' inside it, nowhere in the text.',

    '怎么用': 'How it works',
    '保存': 'Save',
    '粘贴文章、视频或网站链接即可。不用填标题，不用分类，不用打标签。':
      'Paste a link to an article, a video or a site. No title, no folder, no tag.',
    '整理': 'Read',
    '在手机上解析正文、读图里的文字、生成摘要与关键词、建立本地索引。页面上能看到处理状态，失败的条目会说明原因。':
      'On the phone it extracts the text, reads text inside images, writes a summary and keywords, and builds a local index. You can watch each item; failures say why.',
    '找回': 'Find',
    '用一句自然语言描述你记得的大概内容，得到原文，以及「为什么找到它」。':
      'Describe what you remember in one sentence, and get the original back — with a note on why it matched.',
    '保存就结束了。列表会自己长出标题、摘要和状态，不需要你维护。':
      'Saving is the whole job. Titles, summaries and status appear on their own; nothing to maintain.',

    '图片里的字也读得出来': 'It reads the text inside images',
    '很多内容根本不在正文里：公众号的长截图、技术文章里的架构图和思维导图、小红书的图片笔记。Trovia 会把正文里的图片下载下来，用端侧 OCR 把上面的中文读出来，接在原文后面一起索引——所以那些字也能被搜到。':
      'A lot of what matters never reaches the text layer: long screenshots from WeChat, architecture diagrams and mind maps inside technical posts, image-first notes. Trovia downloads the images in an article, reads them with on-device OCR and indexes what it finds — so those words are searchable too.',
    '识别在你自己的手机上完成：图片不经过任何服务器，读出来的文字只写进本机数据库。':
      'Recognition runs on your own phone. Images never leave the device, and the text goes only into the local database.',
    '正文里的图片会一起存下来，图上的文字进索引。':
      'Images in an article are kept with it, and the words on them go into the index.',

    '能读哪些页面': 'What it can read',
    '端侧抓取能力有限，这里如实说明。表格里的结论都可以用':
      'Fetching from a phone has limits, so here they are. Every claim in this table can be reproduced with ',
    '复现。': '.',
    '正常解析': 'Read in full',
    '微信公众号、掘金、少数派、CSDN、V2EX、GitHub、维基百科、简书，以及大多数个人博客和文档站。':
      'WeChat articles, Juejin, SSPAI, CSDN, V2EX, GitHub, Wikipedia, Jianshu, and most personal blogs and documentation sites.',
    '只能拿到链接': 'Link only',
    '知乎、Medium、豆瓣、36 氪这类有登录墙或人机验证的站点，端侧抓不到正文；Trovia 会明确告诉你「需要验证或登录」，而不是假装保存成功。':
      'Sites behind a sign-in or a bot check — Zhihu, Medium, Douban, 36Kr — cannot be read from the phone. Trovia says so plainly instead of pretending the save worked.',
    '图片内容': 'Images',
    '正文里的图片会全部尝试 OCR，识别不出的图片跳过，不影响正文。':
      'Every image in an article is attempted; ones that cannot be read are skipped without affecting the text.',

    '同步写进你自己的云盘': 'Sync into your own cloud',
    '没有账号，也没有中间服务器。填一个 WebDAV 地址，内容就在你的手机和你的网盘之间直接走—— 坚果云、群晖、Nextcloud 都属于这一类，我们只是读写你给的那个目录。':
      'No account and no server in the middle. Point it at a WebDAV address and content moves between your phone and your cloud directly — Nutstore, Synology, Nextcloud. It only reads and writes the folder you give it.',
    '要准备什么': 'What you need',
    '服务器地址、用户名、应用密码。坚果云在「账户信息 → 安全选项 → 添加应用」里生成应用密码，而不是用登录密码。':
      'A server address, a username and an app password. In Nutstore that comes from Account → Security → Add application; the login password will not work.',
    '什么时候同步': 'When it syncs',
    '打开应用时自动跑一轮（最快五分钟一次），也可以手动点「立即同步」；失败不会弹窗打断你，只有手动同步才会说明原因。':
      'A round runs when you open the app, at most every five minutes, and you can tap Sync now. Failures never interrupt you with a dialog; only a manual sync explains itself.',
    '两台都改过': 'Both devices changed it',
    '新的那份占主位，另一份留成「（冲突副本）」，两份内容都在，不会被悄悄覆盖。':
      'The newer one takes the main slot and the other is kept as a "(conflict copy)". Both survive; nothing is silently overwritten.',
    '换应用、换设备': 'Coming from somewhere else',
    '浏览器书签（HTML）、Chrome / Edge 书签（JSON）、CSV、链接清单一键导入；先告诉你「识别到多少条、已有多少条、会新增多少条」，确认后才动手。':
      'Bookmarks HTML, Chrome / Edge bookmarks JSON, CSV or a plain list of links import in one step — and it tells you how many were found, how many you already have and how many are new before it writes anything.',
    '删除会一起同步：删掉的那条在其它设备上也会消失，不会下次同步又冒回来。':
      'Deletes sync too: an item you delete disappears on your other devices and does not come back on the next round.',
    '填一次地址和应用密码就够了：地址、账号都留在本机，密码只进系统钥匙串。':
      'One address and one app password is all: the address and account stay on the phone, the password goes into the system keychain.',

    '我们的四条承诺': 'Four promises',
    '这个产品很小，所以不想把话说满。只有四件事，写在这里当承诺看。':
      'This product is small, so it will not overpromise. Four things, written here as commitments.',
    '数据始终在你自己手里': 'Your data stays yours',
    '收藏、正文、图片、索引都保存在这台设备上；要同步，就写进你自己的云盘。任何时候都能完整导出，随时带走。':
      'Saved items, text, images and the index all live on this device; if you want them elsewhere, they go into your own cloud. You can export everything at any time and leave.',
    '不设功能墙': 'No feature wall',
    '解析、读图里的字、按时间与意思找回——这些能力永远免费。付费只会出现在一件事上：你不想自己准备模型时，由我们代付。':
      'Reading pages, reading text in images, finding things by time or by meaning — these stay free. Paid only means one thing: we pay for the model when you would rather not bring your own.',
    '先把中文站点读好': 'Chinese sites come first',
    '微信公众号、掘金、少数派、CSDN 这类页面优先修。读不到的时候会明确写清原因和你能做什么，不会假装保存成功。':
      'WeChat articles, Juejin, SSPAI, CSDN — these get fixed first. When a page cannot be read it says why, and what you can do, rather than pretending the save worked.',
    '存下来是为了找回来': 'Saving is for finding',
    '这里没有「待读清单」，也不催你读。目标只有一个：几个月后你只记得一句话，也能翻回原文。':
      'There is no reading list and nothing nagging you. The only goal: months later, one remembered sentence is enough to get back to the original.',

    '它不是什么': 'What it is not',
    '不是书签管理器：不需要你维护文件夹和标签；旧书签一次性导入就行。':
      'Not a bookmark manager: no folders or tags to maintain. Import your old bookmarks once and you are done.',
    '不是知识库：不要求先整理、导入或建库。': 'Not a knowledge base: nothing to organise, import or set up first.',
    '不是笔记工具：不提供编辑器，正文按原样保存。': 'Not a note-taking tool: no editor. The text is kept as it was.',
    '不是通用搜索引擎：只搜你保存过的内容，不混入互联网结果。':
      'Not a general search engine: it searches only what you saved, never the open web.',

    '为什么找得回来': 'Why it finds things again',
    '搜索时按标题、关键词、摘要、正文、图片文字、来源分别命中，再按权重融合排序：':
      'Each search matches titles, keywords, summaries, body text, text inside images and source information, then blends the scores:',
    '标题匹配': 'Title',
    '只记得标题里的词': 'You remember a word from the title',
    '关键词': 'Keywords',
    '整理内容时提取的关键词，记得大概主题也能命中': 'Extracted while reading it, so remembering the topic is enough',
    '摘要匹配': 'Summary',
    '记得的是当时那段总结或文章开头': 'You remember the summary or how the piece opened',
    '正文匹配': 'Body text',
    '正文里出现过的词，中文按相邻两个字切分，不依赖分词器': 'Any word in the text; Chinese is split into adjacent character pairs, no tokenizer needed',
    '图片文字': 'Text in images',
    '截图、图表、思维导图上的字，端侧 OCR 读出来后一起参与匹配': 'Words on screenshots, charts and diagrams, read by on-device OCR',
    '来源信息': 'Source',
    '记得作者、公众号或域名': 'You remember the author, the account or the domain',
    '每条结果都会给出匹配原因与命中片段，全部来自真实命中的内容，不会编造文章里没有的东西。 没有接模型时，搜索完全在本机完成：理解查询、建索引、排序都在手机上，不联网。 如果你在设置里接了一个 OpenAI 兼容的模型接口（可以是跑在自己电脑上的 Ollama）， 查询的那句话会发给它来理解意图，建语义索引时正文片段也会发给它算向量； 收藏和索引本身只存在本机数据库里，不会上传到我们这边——我们本来也没有服务器。':
      'Every result says why it matched, quoting what actually matched — nothing is invented. Without a model, search happens entirely on the phone: reading the query, building the index, ranking. If you connect an OpenAI-compatible endpoint in settings (Ollama on your own laptop counts), the sentence you typed is sent to it to read your intent, and snippets are sent to compute vectors for semantic search; the saved items and the index stay in the local database — we have no server to send them to.',

    '深浅两套配色': 'Light and dark, both drawn',
    '界面跟随系统的明暗设置，不额外维护一套主题。深色下不是把黑白对调，而是把纸换成布。':
      'The interface follows the system setting rather than keeping a second theme. Dark is not black inverted: paper becomes cloth.',
    '深色模式跟随系统，强调色只在当前那个动作上出现。':
      'Dark mode follows the system; the accent appears only on the one action that matters.',

    '边界与隐私': 'Limits and privacy',
    '所有收藏保存在你的手机本地，默认不上传任何服务器。': 'Everything is stored on your phone and nothing is uploaded by default.',
    '图片文字识别在设备上完成，图片本身不会被上传。': 'Image text is recognised on the device; the images themselves are never uploaded.',
    '解析失败也保留原始链接，可随时打开原文或重新解析。': 'A failed read still keeps the link, and you can open the original or try again at any time.',
    '不绕过登录、付费墙或任何访问限制，不执行网页里的脚本与指令。':
      'It does not get around sign-ins, paywalls or any access restriction, and it does not run a page’s scripts or instructions.',
    '删除收藏会同时删除本地的正文与索引，之后搜索不会再出现。':
      'Deleting an item removes its text and index entries locally, and it stops appearing in search.',
    '设置里能看清数据存在哪、用了什么整理方式，以及哪些还没做。':
      'Settings make it clear where data lives, how it was read, and what is not built yet.',

    '存下第一个链接': 'Save the first link',
    '粘贴任意文章链接，几秒后它就会被整理好。之后想找它，只需要一句描述。':
      'Paste any article link and it is read within seconds. Finding it later takes one sentence.',
    '数据保存在本机，不需要注册；多端同步在计划中。':
      'Data stays on the device; no sign-up. Sync has landed — see above.',

    'Trovia · Save anything. Find it by memory.': 'Trovia · Save anything. Find it by memory.',
    '数据保存在本机，不需要注册；多端同步走你自己的 WebDAV。':
      'Data stays on the device; no sign-up. Sync runs through your own WebDAV.',
  }

  var META = {
    zh: {
      title: 'Trovia — 存下任何链接，凭记忆找回',
      description:
        'Trovia（原寻迹）是个人链接收藏与智能找回工具：粘贴链接自动抓取正文、图片与摘要，截图里的文字也会被端侧 OCR 读出来；之后用一句自然语言描述就能从自己的收藏里找回原文。免费，数据只保存在你自己的手机上。',
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

  var BACKUP = null

  function apply(lang) {
    var dict = lang === 'en' ? EN : BACKUP
    if (!dict) return
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'

    var meta = META[lang]
    document.title = meta.title
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

    walk(document.body, dict)

    // 截图里的界面也是中文的，所以英文版换一套英文界面的图。
    // 没有对应截图的（例如那张靠图片文字命中的搜索），整块藏起来，
    // 因为换成英文界面就证明不了那句话了。
    document.querySelectorAll('img[data-src-en]').forEach(function (img) {
      var zhSrc = img.getAttribute('data-src-zh') || img.getAttribute('src')
      var zhAlt = img.getAttribute('data-alt-zh') || img.getAttribute('alt')
      if (lang === 'en') {
        img.setAttribute('src', img.getAttribute('data-src-en'))
        img.setAttribute('alt', img.getAttribute('data-alt-en') || '')
      } else {
        img.setAttribute('src', zhSrc)
        img.setAttribute('alt', zhAlt || '')
      }
    })
    document.querySelectorAll('[data-hide-en]').forEach(function (node) {
      node.hidden = lang === 'en'
    })

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

  function snapshot() {
    var map = {}
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
    var node
    while ((node = walker.nextNode())) {
      var key = node.nodeValue.trim()
      if (key) map[key] = node.nodeValue
    }
    return map
  }

  function start() {
    rememberImages()
    BACKUP = snapshot()
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
