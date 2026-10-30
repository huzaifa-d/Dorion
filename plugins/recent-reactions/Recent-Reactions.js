(() => {
  const cleanupKey = '__dorionRecentReactionsCleanup'
  if (typeof window[cleanupKey] === 'function') {
    try {
      window[cleanupKey]()
    } catch (_error) {
      // ignore previous cleanup failure
    }
  }

  const storagePrefix = 'dorion:recent-reactions:'
  const maxHistory = 7
  const toolbarSelector = '#app-mount [class*="buttonsInner_"]'
  const messageContainerSelector = '[id^="chat-messages-"]'
  const hideMarker = 'data-dorion-recent-hidden'
  const hostMarker = 'data-dorion-recent-reactions-host'
  const reactionTypeNormal = 0
  const reactionTypeVote = 2
  const retryDelayMs = 50
  const retryDelayMaxMs = 1000

  const state = {
    cleanup: false,
    started: false,
    retryId: null,
    renderQueued: false,
    frameId: null,
    timeoutId: null,
    deps: null,
    helper: null,
    history: [],
    currentUserId: '',
    memoryStorage: new Map(),
    roots: new Map(),
    unsubscribers: [],
    observer: null,
    unicodeLookupCache: new WeakMap(),
    hiddenDisplayState: new WeakMap(),
    errorBoundaryType: null,
    retryDelay: retryDelayMs,
    debug: {
      helperScans: 0,
      modulesVisited: 0,
      rootCandidates: 0,
      childCandidates: 0,
      getterCalls: 0,
      descriptorReads: 0,
      lastScanMs: 0,
      found: false,
    },
  }

  function isObject(value) {
    return !!value && (typeof value === 'object' || typeof value === 'function')
  }

  function normalizeGlyph(value) {
    if (typeof value !== 'string' || !value) return ''
    return value.replace(/\uFE0F/g, '')
  }

  function safeStorageRead(key) {
    try {
      const raw = window.localStorage?.getItem(key)
      return typeof raw === 'string' ? raw : null
    } catch (_error) {
      return null
    }
  }

  function safeStorageWrite(key, value) {
    try {
      window.localStorage?.setItem(key, value)
    } catch (_error) {
      // storage may be blocked
    }
  }

  function recordKey(record) {
    return record.kind === 'custom' ? `custom:${record.id}` : `unicode:${record.glyph}`
  }

  function sanitizeRecord(record) {
    if (!isObject(record)) return null
    if (record.kind === 'custom') {
      if (typeof record.id !== 'string' || !record.id) return null
      return {
        kind: 'custom',
        id: record.id,
        name: typeof record.name === 'string' ? record.name : '',
        animated: !!record.animated,
      }
    }
    if (record.kind === 'unicode') {
      const glyph = normalizeGlyph(record.glyph)
      if (!glyph) return null
      return {
        kind: 'unicode',
        glyph,
        name: typeof record.name === 'string' ? record.name : '',
      }
    }
    return null
  }

  function sanitizeHistory(records) {
    if (!Array.isArray(records)) return []
    const next = []
    const seen = new Set()
    for (const entry of records) {
      if (next.length >= maxHistory) break
      const clean = sanitizeRecord(entry)
      if (!clean) continue
      const key = recordKey(clean)
      if (seen.has(key)) continue
      seen.add(key)
      next.push(clean)
    }
    return next
  }

  function parseHistory(raw) {
    if (!raw) return []
    try {
      return sanitizeHistory(JSON.parse(raw))
    } catch (_error) {
      return []
    }
  }

  function storageKeyForUser(userId) {
    return `${storagePrefix}${userId}`
  }

  function getCurrentUserId() {
    const user = state.deps?.UserStore?.getCurrentUser?.()
    return typeof user?.id === 'string' ? user.id : ''
  }

  function loadHistoryForUser(userId) {
    if (!userId) return []
    if (state.memoryStorage.has(userId)) return sanitizeHistory(state.memoryStorage.get(userId))
    const parsed = parseHistory(safeStorageRead(storageKeyForUser(userId)))
    state.memoryStorage.set(userId, parsed)
    return parsed
  }

  function persistHistory() {
    if (!state.currentUserId) return
    const clean = sanitizeHistory(state.history)
    state.history = clean
    state.memoryStorage.set(state.currentUserId, clean)
    safeStorageWrite(storageKeyForUser(state.currentUserId), JSON.stringify(clean))
  }

  function replaceCurrentUserIfNeeded() {
    const nextUserId = getCurrentUserId()
    if (nextUserId === state.currentUserId) return
    state.currentUserId = nextUserId
    state.history = loadHistoryForUser(nextUserId)
    queueRender()
  }

  function scheduleRetry() {
    if (state.cleanup || state.started || state.retryId != null) return
    const delay = state.retryDelay
    state.retryId = (window.setTimeout || setTimeout)(() => {
      state.retryId = null
      attemptStart()
    }, delay)
    state.retryDelay = Math.min(state.retryDelay * 2, retryDelayMaxMs)
  }

  function isOwnDeclaredFunction(descriptors, key) {
    const descriptor = descriptors[key]
    return !!descriptor && 'value' in descriptor && typeof descriptor.value === 'function'
  }

  function getOwnDeclaredNumber(descriptors, key) {
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'number') return null
    return descriptor.value
  }

  function getOwnDescriptors(target) {
    try {
      const descriptors = Object.getOwnPropertyDescriptors(target)
      state.debug.descriptorReads += 1
      return descriptors
    } catch (_error) {
      return null
    }
  }

  function discoverPermissionHelper() {
    const startedAt = Date.now()
    state.debug.helperScans += 1
    const runtimes = []
    const chunk = window.webpackChunkdiscord_app
    if (!Array.isArray(chunk) || typeof chunk.push !== 'function') return null
    const key = `dorion_recent_reactions_${Date.now()}_${Math.random()}`
    try {
      chunk.push([[key], {}, (...runtimeArgs) => {
        for (const entry of runtimeArgs) runtimes.push(entry)
      }])
    } catch (_error) {
      return null
    }
    const rootCandidates = []
    const childCandidates = []
    const rootSeen = new Set()
    const childSeen = new Set()
    const pushUnique = (list, seen, value) => {
      if (!isObject(value) || seen.has(value)) return
      seen.add(value)
      list.push(value)
    }
    for (const runtime of runtimes) {
      if (!isObject(runtime?.c)) continue
      for (const moduleRef of Object.values(runtime.c)) {
        state.debug.modulesVisited += 1
        pushUnique(rootCandidates, rootSeen, moduleRef?.exports)
      }
    }
    state.debug.rootCandidates = rootCandidates.length
    for (const root of rootCandidates) {
      const descriptors = getOwnDescriptors(root)
      if (!descriptors) continue
      for (const descriptor of Object.values(descriptors)) {
        if (!descriptor) continue
        if ('value' in descriptor && isObject(descriptor.value)) {
          pushUnique(childCandidates, childSeen, descriptor.value)
          continue
        }
        if (typeof descriptor.get === 'function') {
          state.debug.getterCalls += 1
          let getterValue
          try {
            getterValue = descriptor.get.call(root)
          } catch (_error) {
            continue
          }
          pushUnique(childCandidates, childSeen, getterValue)
        }
      }
    }
    state.debug.childCandidates = childCandidates.length
    const candidates = rootCandidates.concat(childCandidates)
    let filter = null
    let reactionIntention = null
    for (const candidate of candidates) {
      const descriptors = getOwnDescriptors(candidate)
      if (!descriptors) continue
      if (!filter && isOwnDeclaredFunction(descriptors, 'isEmojiFilteredOrLocked') && isOwnDeclaredFunction(descriptors, 'isEmojiDisabled')) {
        filter = candidate
      }
      if (reactionIntention == null) {
        const reaction = getOwnDeclaredNumber(descriptors, 'REACTION')
        const chat = getOwnDeclaredNumber(descriptors, 'CHAT')
        if (reaction != null && chat != null) reactionIntention = reaction
      }
      if (filter && reactionIntention != null) break
    }
    state.debug.lastScanMs = Date.now() - startedAt
    if (!filter || reactionIntention == null) return null
    state.debug.found = true
    return { filter, reactionIntention }
  }

  function collectDependencies() {
    const shelter = window.shelter
    const React = shelter?.React
    const ReactDOMClient = shelter?.ReactDOMClient
    const getFiber = shelter?.util?.getFiber
    const flux = shelter?.flux
    const stores = flux?.stores
    const UserStore = stores?.UserStore
    const EmojiStore = stores?.EmojiStore
    const appMount = document.querySelector?.('#app-mount')
    if (!React || !ReactDOMClient || typeof getFiber !== 'function' || !flux || !UserStore || !EmojiStore || !appMount) return null
    if (!state.helper) state.helper = discoverPermissionHelper()
    if (!state.helper) return null
    return { React, ReactDOMClient, getFiber, flux, UserStore, EmojiStore, appMount }
  }

  function addUnsubscriber(unsubscribe) {
    if (typeof unsubscribe === 'function') state.unsubscribers.push(unsubscribe)
  }

  function isOwnedNode(node) {
    if (!node || typeof node.getAttribute !== 'function') return false
    if (node.getAttribute(hostMarker) === '1') return true
    if (node.getAttribute(hideMarker) === '1') return true
    return !!node.closest?.(`[${hostMarker}]`)
  }

  function isInsidePluginHost(node) {
    if (!node || typeof node.getAttribute !== 'function') return false
    if (node.getAttribute(hostMarker) === '1') return true
    if (node.closest?.(`[${hostMarker}]`)) return true
    if (typeof node.querySelectorAll === 'function' && node.querySelectorAll(`[${hostMarker}]`).length > 0) return true
    return false
  }

  function setupObserver() {
    if (typeof MutationObserver !== 'function' || !state.deps?.appMount) return
    state.observer = new MutationObserver(records => {
      for (const record of records || []) {
        if (record?.type !== 'childList') {
          queueRender()
          return
        }
        if (isInsidePluginHost(record.target)) continue
        const added = Array.from(record.addedNodes || [])
        const removed = Array.from(record.removedNodes || [])
        if (added.some(node => !isOwnedNode(node)) || removed.some(node => !isOwnedNode(node))) {
          queueRender()
          return
        }
      }
    })
    state.observer.observe(state.deps.appMount, {
      subtree: true,
      childList: true,
    })
  }

  function attemptStart() {
    if (state.cleanup || state.started) return
    const deps = collectDependencies()
    if (!deps) {
      scheduleRetry()
      return
    }
    state.deps = deps
    state.retryDelay = retryDelayMs
    state.errorBoundaryType = class ErrorBoundary extends deps.React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch() {
        this.props.onError?.()
      }
      render() {
        if (this.state.failed) return null
        return this.props.children
      }
    }
    state.started = true
    replaceCurrentUserIfNeeded()
    addUnsubscriber(deps.flux.intercept?.(handleFluxEvent))
    const onUserChange = () => replaceCurrentUserIfNeeded()
    if (typeof deps.UserStore.addChangeListener === 'function' && typeof deps.UserStore.removeChangeListener === 'function') {
      deps.UserStore.addChangeListener(onUserChange)
      addUnsubscriber(() => deps.UserStore.removeChangeListener(onUserChange))
    }
    setupObserver()
    queueRender()
  }

  function getUnicodeLookup(context) {
    if (!isObject(context)) return new Map()
    if (state.unicodeLookupCache.has(context)) return state.unicodeLookupCache.get(context)
    const byGlyph = new Map()
    const visited = new Set()
    function addEntry(entry) {
      if (!isObject(entry) || visited.has(entry)) return
      visited.add(entry)
      const glyph = normalizeGlyph(entry.surrogates || entry.emojiObject?.surrogates || '')
      const uniqueName = typeof entry.uniqueName === 'string' ? entry.uniqueName : ''
      if (glyph) byGlyph.set(glyph, { glyph, uniqueName, entry })
      const children = entry.diversityChildren
      if (isObject(children)) {
        for (const child of Object.values(children)) addEntry(child)
      }
    }
    const values = context.emojisByName?.values?.()
    if (values && typeof values.next === 'function') {
      for (const entry of context.emojisByName.values()) addEntry(entry)
    }
    state.unicodeLookupCache.set(context, byGlyph)
    return byGlyph
  }

  function buildRecordFromAddEvent(emoji) {
    if (!isObject(emoji)) return null
    const EmojiStore = state.deps?.EmojiStore
    if (typeof emoji.id === 'string' && emoji.id) {
      const native = EmojiStore?.getCustomEmojiById?.(emoji.id)
      return sanitizeRecord({
        kind: 'custom',
        id: emoji.id,
        name: typeof emoji.name === 'string' ? emoji.name : typeof native?.name === 'string' ? native.name : '',
        animated: !!(emoji.animated || native?.animated),
      })
    }
    const context = EmojiStore?.getDisambiguatedEmojiContext?.(null)
    const lookup = getUnicodeLookup(context)
    const glyph = normalizeGlyph(emoji.name || '')
    const resolved = lookup.get(glyph)
    return sanitizeRecord({
      kind: 'unicode',
      glyph,
      name: resolved?.uniqueName || '',
    })
  }

  function prependRecord(record) {
    if (!record) return false
    const key = recordKey(record)
    const next = [record]
    for (const existing of state.history) {
      if (next.length >= maxHistory) break
      if (recordKey(existing) === key) continue
      next.push(existing)
    }
    const changed = JSON.stringify(next) !== JSON.stringify(state.history)
    state.history = next
    return changed
  }

  function resolveRecordToEmoji(record, channel) {
    const helper = state.helper
    const EmojiStore = state.deps?.EmojiStore
    if (!helper || !EmojiStore) return null
    const context = EmojiStore.getDisambiguatedEmojiContext?.(channel?.guild_id || null)
    if (!context) return null
    let emoji = null
    if (record.kind === 'custom') {
      const usable = EmojiStore.getUsableCustomEmojiById?.(record.id)
      if (!usable) return null
      emoji = usable
    } else {
      const lookup = getUnicodeLookup(context)
      const entry = lookup.get(normalizeGlyph(record.glyph))
      if (entry?.uniqueName && typeof context.getByName === 'function') emoji = context.getByName(entry.uniqueName)
      if (!emoji && record.name && typeof context.getByName === 'function') emoji = context.getByName(record.name)
      if (!emoji && entry?.entry) emoji = entry.entry
      if (!emoji) return null
    }
    const args = {
      emoji,
      channel,
      intention: helper.reactionIntention,
      guildId: channel?.guild_id || null,
    }
    try {
      if (helper.filter.isEmojiFilteredOrLocked(args)) return null
      if (helper.filter.isEmojiDisabled(args)) return null
    } catch (_error) {
      return null
    }
    return emoji
  }

  function setNodeHidden(node, hidden) {
    if (!node) return
    const wasHidden = node.getAttribute?.(hideMarker) === '1'
    const getValue = () => node.style?.getPropertyValue?.('display') ?? ''
    const getPriority = () => node.style?.getPropertyPriority?.('display') ?? ''
    if (hidden) {
      if (!state.hiddenDisplayState.has(node)) {
        state.hiddenDisplayState.set(node, {
          value: getValue(),
          priority: getPriority(),
        })
      }
      if (!wasHidden) node.setAttribute?.(hideMarker, '1')
      if (getValue() !== 'none' || getPriority() !== '') node.style?.setProperty?.('display', 'none')
      return
    }
    if (wasHidden) node.removeAttribute?.(hideMarker)
    const snapshot = state.hiddenDisplayState.get(node)
    if (!snapshot) return
    state.hiddenDisplayState.delete(node)
    if (snapshot.value) {
      node.style?.setProperty?.('display', snapshot.value, snapshot.priority || '')
      return
    }
    node.style?.removeProperty?.('display')
  }

  function clearHidden(toolbar) {
    const hiddenNodes = toolbar.querySelectorAll?.(`[${hideMarker}]`) || []
    for (const node of hiddenNodes) setNodeHidden(node, false)
  }

  function getToolbarParts(toolbar) {
    const children = Array.from(toolbar.children || []).filter(node => node.getAttribute?.(hostMarker) !== '1')
    if (children.length < 9) return null
    const quickWrappers = [children[0], children[2], children[4]]
    const quickLabels = [children[1], children[3], children[5]]
    const separator = children[6] || null
    const addWrapper = children[7] || null
    const addButton = addWrapper?.querySelector?.('[role="button"]') || null
    const quickButtons = quickWrappers.map(node => node?.querySelector?.('[role="button"]') || null)
    if (quickButtons.some(button => !button) || !addButton) return null
    return { quickWrappers, quickLabels, quickButtons, separator, addButton }
  }

  function findQuickTemplate(button) {
    let node = state.deps?.getFiber?.(button)
    for (let depth = 0; node && depth < 24; depth += 1) {
      const props = node.memoizedProps
      const child = props?.children
      const childProps = child?.props
      const hasTooltipShape = typeof props?.tooltipText !== 'undefined' || typeof props?.label !== 'undefined'
      const childType = child?.type
      const validEmojiType = typeof childType === 'function' || (isObject(childType) && typeof childType !== 'string')
      if (typeof props?.onClick === 'function' && hasTooltipShape && childProps?.size === 'reaction' && childProps?.canSelect === false && validEmojiType) {
        return {
          tooltipType: node.type,
          tooltipProps: props,
          emojiType: childType,
          emojiProps: childProps,
        }
      }
      node = node.return
    }
    return null
  }

  function getNativeEmojiName(nativeEmoji, record) {
    if (nativeEmoji?.id) {
      return typeof nativeEmoji.name === 'string' && nativeEmoji.name
        ? nativeEmoji.name
        : (record?.name || '')
    }
    const surrogate = normalizeGlyph(nativeEmoji?.surrogates || nativeEmoji?.emojiObject?.surrogates || '')
    if (surrogate) return surrogate
    const fallbackGlyph = normalizeGlyph(record?.glyph || '')
    if (fallbackGlyph) return fallbackGlyph
    return typeof nativeEmoji?.name === 'string' ? nativeEmoji.name : ''
  }

  function findAddReactionSource(addButton) {
    let node = state.deps?.getFiber?.(addButton)
    for (let depth = 0; node && depth < 24; depth += 1) {
      const props = node.memoizedProps
      if (typeof props?.renderEmojiPicker === 'function' && props.channel && props.message) return props
      node = node.return
    }
    return null
  }

  function getPickerSelect(source) {
    if (!source || typeof source.renderEmojiPicker !== 'function') return null
    let pickerElement
    try {
      pickerElement = source.renderEmojiPicker(source.channel, source.message, () => {}, false)
    } catch (_error) {
      return null
    }
    const select = pickerElement?.props?.onSelectEmoji
    if (typeof select !== 'function') return null
    return select
  }

  function ensureHost(toolbar) {
    const existing = state.roots.get(toolbar)
    if (existing) return existing
    const host = document.createElement('span')
    host.setAttribute(hostMarker, '1')
    host.style?.setProperty?.('display', 'contents')
    toolbar.insertBefore(host, toolbar.firstChild || null)
    let root
    try {
      root = state.deps.ReactDOMClient.createRoot(host)
    } catch (_error) {
      host.remove()
      return null
    }
    const entry = { host, root }
    state.roots.set(toolbar, entry)
    return entry
  }

  function removeHost(toolbar) {
    const entry = state.roots.get(toolbar)
    if (!entry) return
    try {
      entry.root.unmount()
    } catch (_error) {
      // best effort unmount
    }
    entry.host.remove()
    state.roots.delete(toolbar)
  }

  function restoreNative(toolbar) {
    clearHidden(toolbar)
    removeHost(toolbar)
  }

  function sameMessage(targetMessage, sourceMessage) {
    if (targetMessage === sourceMessage) return true
    const targetId = typeof targetMessage?.id === 'string' ? targetMessage.id : ''
    const sourceId = typeof sourceMessage?.id === 'string' ? sourceMessage.id : ''
    return !!targetId && targetId === sourceId
  }

  function buildEmojiTokens(emoji, record) {
    const tokens = new Set()
    const add = value => {
      if (typeof value !== 'string') return
      const normalized = normalizeGlyph(value)
      if (normalized) tokens.add(normalized)
    }
    if (emoji?.id) add(`id:${emoji.id}`)
    add(emoji?.name)
    add(emoji?.surrogates)
    add(emoji?.uniqueName)
    add(emoji?.emojiObject?.surrogates)
    add(record?.name)
    add(record?.glyph)
    return tokens
  }

  function extractGlyphToken(emoji, record) {
    const fromEmoji = normalizeGlyph(emoji?.surrogates || emoji?.emojiObject?.surrogates || '')
    if (fromEmoji) return fromEmoji
    const fromReaction = normalizeGlyph(emoji?.name || '')
    if (fromReaction) return fromReaction
    const fromRecord = normalizeGlyph(record?.glyph || '')
    if (fromRecord) return fromRecord
    return ''
  }

  function sameEmoji(reactionEmoji, nativeEmoji, record) {
    if (!reactionEmoji || !nativeEmoji) return false
    if (nativeEmoji.id || reactionEmoji.id) {
      return !!reactionEmoji.id && !!nativeEmoji.id && reactionEmoji.id === nativeEmoji.id
    }
    const reactionGlyph = extractGlyphToken(reactionEmoji, null)
    const nativeGlyph = extractGlyphToken(nativeEmoji, record)
    if (reactionGlyph && nativeGlyph) return reactionGlyph === nativeGlyph
    const reactionTokens = buildEmojiTokens(reactionEmoji, null)
    const nativeTokens = buildEmojiTokens(nativeEmoji, record)
    for (const token of reactionTokens) {
      if (nativeTokens.has(token)) return true
    }
    return false
  }

  function findOwnRemovalHandler(toolbar, message, emoji, record) {
    const messageContainer = toolbar.closest?.(messageContainerSelector)
    if (!messageContainer || !message || !emoji) return null
    if (!/^chat-messages-\d+-\d+$/.test(String(messageContainer.id || ''))) return null
    const pills = messageContainer.querySelectorAll?.('[role="button"]') || []
    for (const pill of pills) {
      if (pill.getAttribute?.('aria-pressed') !== 'true') continue
      if (pill.getAttribute?.('aria-disabled') === 'true') continue
      let node = state.deps?.getFiber?.(pill)
      let clickHandler = null
      for (let depth = 0; node && depth < 12; depth += 1) {
        if (!clickHandler && typeof node.memoizedProps?.onClick === 'function') clickHandler = node.memoizedProps.onClick
        const props = node.memoizedProps
        if (props?.message && props?.emoji && props?.me === true && props?.type === reactionTypeNormal) {
          if (!sameMessage(props.message, message)) break
          if (!sameEmoji(props.emoji, emoji, record)) break
          return clickHandler
        }
        node = node.return
      }
    }
    return null
  }

  function isOwnNormalReaction(reaction) {
    if (!reaction || reaction.me !== true) return false
    if (typeof reaction.type === 'number' && reaction.type !== reactionTypeNormal) return false
    return true
  }

  function tryRemoveOwnReaction(toolbar, sourceMessage, emoji, record, event) {
    if (!Array.isArray(sourceMessage?.reactions)) return 'blocked'
    const normalOwnReactions = sourceMessage.reactions.filter(
      reaction => isOwnNormalReaction(reaction),
    )
    const hasOwn = normalOwnReactions.some(reaction => sameEmoji(reaction.emoji, emoji, record))
    if (!hasOwn) return 'absent'
    const handler = findOwnRemovalHandler(toolbar, sourceMessage, emoji, record)
    if (typeof handler !== 'function') return 'blocked'
    try {
      handler(event)
      return 'removed'
    } catch (_error) {
      return 'blocked'
    }
  }

  function handleShortcutClick(toolbar, record, event) {
    const parts = getToolbarParts(toolbar)
    if (!parts) {
      restoreNative(toolbar)
      return
    }
    const source = findAddReactionSource(parts.addButton)
    const select = getPickerSelect(source)
    if (!source || !select) {
      restoreNative(toolbar)
      return
    }
    const emoji = resolveRecordToEmoji(record, source.channel)
    if (!emoji) return
    const removeResult = tryRemoveOwnReaction(toolbar, source.message, emoji, record, event)
    if (removeResult === 'removed') return
    if (removeResult === 'blocked') return
    select({
      emoji,
      willClose: false,
      isBurst: false,
    })
  }

  function renderToolbar(toolbar) {
    const parts = getToolbarParts(toolbar)
    if (!parts) {
      restoreNative(toolbar)
      return
    }
    const template = findQuickTemplate(parts.quickButtons[0])
    const source = findAddReactionSource(parts.addButton)
    const select = getPickerSelect(source)
    if (!template || !source || !select || !state.helper) {
      restoreNative(toolbar)
      return
    }
    const resolved = []
    for (const record of state.history) {
      if (resolved.length >= maxHistory) break
      const emoji = resolveRecordToEmoji(record, source.channel)
      if (!emoji) continue
      resolved.push({ record, emoji })
    }
    const hostEntry = ensureHost(toolbar)
    if (!hostEntry) {
      restoreNative(toolbar)
      return
    }
    const React = state.deps.React
    const ErrorBoundary = state.errorBoundaryType
    if (typeof ErrorBoundary !== 'function') {
      restoreNative(toolbar)
      return
    }
    const buttons = resolved.map((entry, index) => {
      const emoji = entry.emoji
      const label = entry.record.kind === 'custom'
        ? `:${entry.record.name || emoji.name || 'emoji'}:`
        : (entry.record.name || emoji.uniqueName || entry.record.glyph)
      return React.createElement(template.tooltipType, {
        ...template.tooltipProps,
        key: `${recordKey(entry.record)}:${index}`,
        label,
        tooltipText: label,
        onClick: event => handleShortcutClick(toolbar, entry.record, event),
        children: React.createElement(template.emojiType, {
          ...template.emojiProps,
          emojiId: emoji.id || null,
          emojiName: getNativeEmojiName(emoji, entry.record),
          animated: !!emoji.animated,
          alt: '',
          size: 'reaction',
          canSelect: false,
        }),
      })
    })
    try {
      hostEntry.root.render(
        React.createElement(ErrorBoundary, {
          onError: () => restoreNative(toolbar),
          children: React.createElement(React.Fragment, null, buttons),
        }),
      )
    } catch (_error) {
      restoreNative(toolbar)
      return
    }
    for (const wrapper of parts.quickWrappers) setNodeHidden(wrapper, true)
    for (const hidden of parts.quickLabels) setNodeHidden(hidden, true)
    setNodeHidden(parts.separator, resolved.length === 0)
  }

  function renderAll() {
    state.renderQueued = false
    const toolbars = document.querySelectorAll?.(toolbarSelector) || []
    const current = new Set(toolbars)
    for (const toolbar of toolbars) renderToolbar(toolbar)
    for (const existing of Array.from(state.roots.keys())) {
      if (current.has(existing)) continue
      removeHost(existing)
    }
  }

  function queueRender() {
    if (state.cleanup || !state.started || state.renderQueued) return
    state.renderQueued = true
    const raf = window.requestAnimationFrame || requestAnimationFrame
    if (typeof raf === 'function') {
      state.frameId = raf(() => {
        state.frameId = null
        renderAll()
      })
      return
    }
    const timeout = window.setTimeout || setTimeout
    state.timeoutId = timeout(() => {
      state.timeoutId = null
      renderAll()
    }, 0)
  }

  function handleFluxEvent(event) {
    if (!event || event.type !== 'MESSAGE_REACTION_ADD') return undefined
    if (event.optimistic || event.isOptimistic || event.error) return undefined
    if (event.reactionType === reactionTypeVote) return undefined
    const userId = typeof event.userId === 'string' ? event.userId : ''
    if (!userId || userId !== getCurrentUserId()) return undefined
    const record = buildRecordFromAddEvent(event.emoji)
    if (!record) return undefined
    if (!prependRecord(record)) return undefined
    persistHistory()
    queueRender()
    return undefined
  }

  function cleanup() {
    if (state.cleanup) return
    state.cleanup = true
    if (state.retryId != null) {
      try {
        (window.clearTimeout || clearTimeout)(state.retryId)
      } catch (_error) {
        // ignore timer cleanup errors
      }
      state.retryId = null
    }
    if (state.frameId != null) {
      try {
        (window.cancelAnimationFrame || cancelAnimationFrame)(state.frameId)
      } catch (_error) {
        // ignore frame cleanup errors
      }
      state.frameId = null
    }
    if (state.timeoutId != null) {
      try {
        (window.clearTimeout || clearTimeout)(state.timeoutId)
      } catch (_error) {
        // ignore timeout cleanup errors
      }
      state.timeoutId = null
    }
    for (const unsubscribe of state.unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch (_error) {
        // best effort cleanup
      }
    }
    if (state.observer) {
      try {
        state.observer.disconnect()
      } catch (_error) {
        // best effort observer cleanup
      }
      state.observer = null
    }
    for (const toolbar of Array.from(state.roots.keys())) restoreNative(toolbar)
    const toolbars = document.querySelectorAll?.(toolbarSelector) || []
    for (const toolbar of toolbars) clearHidden(toolbar)
    state.renderQueued = false
  }

  window[cleanupKey] = cleanup
  window.__dorionRecentReactionsDebug = () => ({
    helperScans: state.debug.helperScans,
    modulesVisited: state.debug.modulesVisited,
    rootCandidates: state.debug.rootCandidates,
    childCandidates: state.debug.childCandidates,
    getterCalls: state.debug.getterCalls,
    descriptorReads: state.debug.descriptorReads,
    lastScanMs: state.debug.lastScanMs,
    found: state.debug.found,
    started: state.started,
  })
  attemptStart()
})()
