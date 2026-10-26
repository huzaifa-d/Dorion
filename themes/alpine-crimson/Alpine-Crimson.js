(() => {
  window.__alpineCrimsonCleanup?.()

  const targetName = 'Alex'
  const label = CSS.escape(`${targetName} (direct message)`)
  const selector = `#app-mount [class^="privateChannels_"] [class*="interactive_"]:has(> a[aria-label="${label}"])`
  const options = { capture: true, passive: true }
  let active = null
  let target = null

  const clear = () => {
    if (!active) return
    active.removeAttribute('data-alpine-halo-active')
    active.style.removeProperty('--alpine-halo-x')
    active.style.removeProperty('--alpine-halo-y')
    active = null
  }

  const syncTarget = () => {
    const row = document.querySelector(selector)
    if (row === target) return
    clear()
    target?.removeAttribute('data-alpine-halo-target')
    target = row
    target?.setAttribute('data-alpine-halo-target', '')
  }

  const move = event => {
    const row = event.target instanceof Element ? event.target.closest(selector) : null
    if (!row || getComputedStyle(document.documentElement).getPropertyValue('--alpine-pointer-halo').trim() !== '1') {
      clear()
      return
    }
    if (active !== row) {
      clear()
      active = row
    }
    const bounds = row.getBoundingClientRect()
    row.style.setProperty('--alpine-halo-x', `${event.clientX - bounds.left}px`)
    row.style.setProperty('--alpine-halo-y', `${event.clientY - bounds.top}px`)
    row.setAttribute('data-alpine-halo-active', '')
  }

  const leave = event => {
    if (!(event.relatedTarget instanceof Element) || !active?.contains(event.relatedTarget)) clear()
  }

  document.addEventListener('pointermove', move, options)
  document.addEventListener('pointerout', leave, options)
  document.addEventListener('pointercancel', clear, options)
  window.addEventListener('blur', clear)
  const observer = new MutationObserver(syncTarget)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  syncTarget()

  window.__alpineCrimsonCleanup = () => {
    clear()
    observer.disconnect()
    target?.removeAttribute('data-alpine-halo-target')
    document.removeEventListener('pointermove', move, options)
    document.removeEventListener('pointerout', leave, options)
    document.removeEventListener('pointercancel', clear, options)
    window.removeEventListener('blur', clear)
    delete window.__alpineCrimsonCleanup
  }
})()
