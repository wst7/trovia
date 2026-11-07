/**
 * Landing page behaviour: floating navigation, scroll reveals, and the
 * word by word tagline reveal.
 *
 * No framework and no dependencies. Motion is limited to transform and
 * opacity, every interruptible transition uses the shared easing curve,
 * and prefers-reduced-motion removes movement instead of shortening it.
 */
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* ------------------------------------------------------------------ */
  /* Tagline: words activate one at a time as the line is crossed        */
  /* ------------------------------------------------------------------ */

  var TAGLINE = {
    zh: ['收藏不是仓库。', '是你脑子里那半句话。'],
    en: ['A save is not a filing cabinet.', 'It is the half sentence you still remember.'],
  }

  var taglineEl = document.querySelector('[data-tagline]')
  var wordObserver = null

  /** Chinese reads per character, English per word. Punctuation stays glued. */
  function tokenize(line, lang) {
    if (lang === 'en') {
      return line.split(' ').map(function (word) {
        return { text: word, space: true }
      })
    }
    var glued = '。，、；：！？）」』'
    var out = []
    Array.from(line).forEach(function (ch) {
      if (glued.indexOf(ch) !== -1 && out.length) out[out.length - 1].text += ch
      else out.push({ text: ch, space: false })
    })
    return out
  }

  function renderTagline() {
    if (!taglineEl) return
    var lang = document.documentElement.lang === 'en' ? 'en' : 'zh'
    var lines = TAGLINE[lang]

    if (wordObserver) {
      wordObserver.disconnect()
      wordObserver = null
    }
    taglineEl.textContent = ''

    var words = []
    lines.forEach(function (line) {
      var lineEl = document.createElement('span')
      lineEl.className = 'tagline-line'
      tokenize(line, lang).forEach(function (token) {
        var wordEl = document.createElement('span')
        wordEl.className = 'tagline-word'
        wordEl.textContent = token.text
        lineEl.appendChild(wordEl)
        if (token.space) lineEl.appendChild(document.createTextNode(' '))
        words.push(wordEl)
      })
      taglineEl.appendChild(lineEl)
    })

    if (reduceMotion) {
      words.forEach(function (w) {
        w.classList.add('is-on')
      })
      return
    }

    // Stagger by position, capped so a long line never drags.
    words.forEach(function (w, i) {
      w.style.transitionDelay = Math.min(i * 40, 400) + 'ms'
    })

    wordObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-on')
          wordObserver.unobserve(entry.target)
        })
      },
      { threshold: 0.01, rootMargin: '0px 0px -12% 0px' },
    )

    words.forEach(function (w) {
      wordObserver.observe(w)
    })
  }

  /* ------------------------------------------------------------------ */
  /* Scroll reveals                                                      */
  /* ------------------------------------------------------------------ */

  function initReveals() {
    var targets = document.querySelectorAll('[data-reveal]')
    if (!targets.length) return

    if (reduceMotion) {
      targets.forEach(function (el) {
        el.classList.add('is-in')
      })
      return
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )

    targets.forEach(function (el) {
      observer.observe(el)
    })
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  function initNav() {
    var toggle = document.querySelector('.nav-toggle')
    var menu = document.getElementById('menu')
    if (!toggle || !menu) return

    var links = Array.prototype.slice.call(menu.querySelectorAll('a'))
    links.forEach(function (link, i) {
      link.style.transitionDelay = Math.min(i * 60, 400) + 'ms'
    })

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
      document.body.style.overflow = open ? 'hidden' : ''

      if (open) {
        menu.hidden = false
        // Force a frame so the panel paints before the transition starts.
        requestAnimationFrame(function () {
          menu.classList.add('is-open')
        })
      } else {
        menu.classList.remove('is-open')
        menu.hidden = true
      }
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true')
    })

    links.forEach(function (link) {
      link.addEventListener('click', function () {
        setOpen(false)
      })
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false)
        toggle.focus()
      }
    })

    window.addEventListener('resize', function () {
      if (window.innerWidth > 959 && toggle.getAttribute('aria-expanded') === 'true') setOpen(false)
    })
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  renderTagline()
  initReveals()
  initNav()

  // i18n swaps the copy after the language changes, so the tagline is
  // rebuilt from the new language and observed again.
  document.addEventListener('trovia:lang', renderTagline)
})()
