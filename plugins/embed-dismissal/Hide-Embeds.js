(() => {
  window.__dorionHideEmbedsCleanup?.()

  const embedSelector = '[class*="embedFull_"], [class*="inlineMediaEmbed_"]'
  const giftSelector = '[class*="gift" i], [class*="collectibles" i]'
  const protectedSelector = `${giftSelector}, [class*="attachment_"], [class*="imageContent_"], [class*="visualMediaItemContainer_"], [class*="mosaicItem_"]`
  const records = new Map()
  const buttons = new WeakMap()
  const hidden = new Set()
  let frame = 0

  const style = document.createElement('style')
  style.setAttribute('data-dorion-embed-style', '')
  style.textContent = `
    #app-mount [data-dorion-embed-position] { position: relative; }
    #app-mount [data-dorion-embed-hidden] { display: none !important; }
    #app-mount button[data-dorion-embed-action] {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      padding: 2px 8px;
      border: 1px solid var(--background-modifier-accent, #62576b);
      border-radius: 4px;
      background: var(--background-secondary, #29232e);
      color: var(--text-normal, #eee);
      font: inherit;
      line-height: 20px;
      cursor: var(--alpine-cursor, pointer);
    }
    #app-mount button[data-dorion-embed-action="hide"]:not([data-dorion-embed-external]) {
      position: absolute;
      top: 4px;
      right: 4px;
      z-index: 3;
      width: 24px;
      height: 24px;
      padding: 0;
      font-size: 20px;
      opacity: 0;
      pointer-events: none;
    }
    #app-mount [data-dorion-embed]:hover > button[data-dorion-embed-action="hide"],
    #app-mount [data-dorion-embed]:focus-within > button[data-dorion-embed-action="hide"] {
      opacity: 1;
      pointer-events: auto;
    }
    #app-mount button[data-dorion-embed-action]:focus-visible {
      opacity: 1;
      outline: 2px solid var(--text-link, #bda0ff);
      outline-offset: 2px;
    }
    #app-mount button[data-dorion-embed-action]:hover {
      border-color: var(--interactive-hover, #fff);
    }
    #app-mount button[data-dorion-embed-action][hidden] { display: none !important; }
  `
  document.head.append(style)

  const createButton = () => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '\u00d7'
    button.setAttribute('data-dorion-embed-action', 'hide')
    button.setAttribute('aria-label', 'Hide embed')
    button.title = 'Hide this embed for you until reload'
    return button
  }

  const restore = record => {
    record.embed.removeAttribute('data-dorion-embed')
    record.embed.removeAttribute('data-dorion-embed-hidden')
    record.embed.removeAttribute('data-dorion-embed-position')
    record.hide.remove()
    buttons.delete(record.hide)
  }

  const render = record => {
    const { embed, hide, external, key } = record
    embed.setAttribute('data-dorion-embed', '')
    if (external) {
      if (hide.parentElement !== embed.parentElement || hide.nextElementSibling !== embed) embed.before(hide)
    } else if (hide.parentElement !== embed) {
      embed.append(hide)
    }
    const dismissed = hidden.has(key)
    embed.toggleAttribute('data-dorion-embed-hidden', dismissed)
    hide.hidden = dismissed
  }

  const sync = () => {
    const mount = document.querySelector('#app-mount')
    const candidates = [...(mount?.querySelectorAll(embedSelector) || [])].filter(embed => {
      const message = embed.closest('[id^="chat-messages-"]')
      return message && /^chat-messages-\d+-\d+$/.test(message.id) &&
        !embed.closest(protectedSelector) && !embed.querySelector(giftSelector) &&
        !embed.parentElement.closest(embedSelector) &&
        !embed.parentElement.closest('a, button, [role="button"], [role="link"]')
    })
    const present = new Set(candidates)
    for (const [embed, record] of records) {
      if (present.has(embed)) continue
      restore(record)
      records.delete(embed)
    }
    const positions = new Map()
    for (const embed of candidates) {
      const message = embed.closest('[id^="chat-messages-"]')
      const position = positions.get(message) || 0
      positions.set(message, position + 1)
      const key = `${message.id}:${position}`
      let record = records.get(embed)
      if (!record) {
        const external = !!embed.closest('a, button, [role="button"], [role="link"]') ||
          embed.matches('img, video, audio, iframe')
        record = {
          embed,
          key,
          external,
          hide: createButton(),
        }
        if (external) record.hide.setAttribute('data-dorion-embed-external', '')
        if (!external && getComputedStyle(embed).position === 'static') {
          embed.setAttribute('data-dorion-embed-position', '')
        }
        records.set(embed, record)
        buttons.set(record.hide, record)
      }
      record.key = key
      render(record)
    }
  }

  const ownedButton = event => {
    const button = event.target instanceof Element
      ? event.target.closest('button[data-dorion-embed-action]')
      : null
    const record = buttons.get(button)
    return record && record.embed.isConnected ? { button, record } : null
  }

  const click = event => {
    const control = ownedButton(event)
    if (!control) return
    event.preventDefault()
    event.stopPropagation()
    const { button, record } = control
    button.blur()
    hidden.add(record.key)
    render(record)
    record.embed.parentElement.closest('[tabindex]')?.focus({ preventScroll: true })
  }

  const pointerdown = event => {
    if (ownedButton(event)) event.stopPropagation()
  }

  const keydown = event => {
    if ((event.key === 'Enter' || event.key === ' ') && ownedButton(event)) event.stopPropagation()
  }

  document.addEventListener('click', click, true)
  document.addEventListener('pointerdown', pointerdown, true)
  document.addEventListener('keydown', keydown, true)
  const observer = new MutationObserver(() => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0
        sync()
      })
    }
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id'],
  })
  sync()

  window.__dorionHideEmbedsCleanup = () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    document.removeEventListener('click', click, true)
    document.removeEventListener('pointerdown', pointerdown, true)
    document.removeEventListener('keydown', keydown, true)
    for (const record of records.values()) restore(record)
    records.clear()
    hidden.clear()
    style.remove()
    delete window.__dorionHideEmbedsCleanup
  }
})()
