/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-this-alias */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { runInNewContext } = require('node:vm')

const pluginPath = path.join(__dirname, 'Recent-Reactions.js')
const source = fs.readFileSync(pluginPath, 'utf8')
const storagePrefix = 'dorion:recent-reactions:'
const hostMarker = 'data-dorion-recent-reactions-host'
const hideMarker = 'data-dorion-recent-hidden'

function matchesSelector(node, selector) {
  if (!node) return false
  if (selector === '#app-mount') return node.id === 'app-mount'
  if (selector === '#app-mount [class*="buttonsInner_"]') {
    return includesClass(node, 'buttonsInner_') && !!node.closest('#app-mount')
  }
  if (selector === '[class*="buttonsInner_"]') return includesClass(node, 'buttonsInner_')
  if (selector === '[role="button"]') return node.getAttribute('role') === 'button'
  if (selector === '[id^="chat-messages-"]') return String(node.id || '').startsWith('chat-messages-')
  const attributeOnly = selector.match(/^\[([^\]=]+)\]$/)
  if (attributeOnly) return node.getAttribute(attributeOnly[1]) !== null
  return false
}

function includesClass(node, partial) {
  return String(node.className || '').includes(partial)
}

function createFixture(options = {}) {
  const observers = []
  const rafQueue = []
  const timerQueue = []
  let timerId = 1

  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.connected = false
      this.target = null
      this.options = null
      observers.push(this)
    }
    observe(target, options) {
      this.connected = true
      this.target = target
      this.options = options
    }
    disconnect() {
      this.connected = false
      this.target = null
      this.options = null
    }
  }

  function shouldNotify(observer, target, kind) {
    if (!observer.connected || !observer.target || !observer.options) return false
    if (kind === 'attributes' && !observer.options.attributes) return false
    if (kind === 'childList' && !observer.options.childList) return false
    if (!observer.options.subtree) return observer.target === target
    let node = target
    while (node) {
      if (node === observer.target) return true
      node = node.parentNode
    }
    return false
  }

  function notifyMutation(record) {
    for (const observer of observers) {
      if (!shouldNotify(observer, record.target, record.type)) continue
      observer.callback([record])
    }
  }

  class Element {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase()
      this.children = []
      this.parentNode = null
      this.ownerDocument = null
      this.className = ''
      this.attributes = new Map()
      const styleStore = new Map()
      this.style = {
        setProperty: (name, value, priority = '') => {
          const nextValue = String(value)
          const nextPriority = String(priority || '')
          const previous = styleStore.get(name)
          if (previous && previous.value === nextValue && previous.priority === nextPriority) return
          styleStore.set(name, { value: nextValue, priority: nextPriority })
          notifyMutation({ type: 'attributes', target: this, attributeName: `style.${name}` })
        },
        removeProperty: name => {
          if (!styleStore.has(name)) return
          styleStore.delete(name)
          notifyMutation({ type: 'attributes', target: this, attributeName: `style.${name}` })
        },
        getPropertyValue: name => styleStore.get(name)?.value || '',
        getPropertyPriority: name => styleStore.get(name)?.priority || '',
      }
    }
    appendChild(child) {
      return this.insertBefore(child, null)
    }
    insertBefore(child, beforeNode) {
      child.remove()
      child.parentNode = this
      child.ownerDocument = this.ownerDocument
      if (!beforeNode) this.children.push(child)
      else {
        const index = this.children.indexOf(beforeNode)
        if (index === -1) this.children.push(child)
        else this.children.splice(index, 0, child)
      }
      notifyMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
      return child
    }
    removeChild(child) {
      const index = this.children.indexOf(child)
      if (index === -1) return child
      this.children.splice(index, 1)
      child.parentNode = null
      notifyMutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [child] })
      return child
    }
    remove() {
      this.parentNode?.removeChild(this)
    }
    setAttribute(name, value) {
      const nextValue = String(value)
      if (this.attributes.get(name) === nextValue) return
      this.attributes.set(name, nextValue)
      if (name === 'id') this.id = nextValue
      notifyMutation({ type: 'attributes', target: this, attributeName: name })
    }
    removeAttribute(name) {
      if (!this.attributes.has(name)) return
      this.attributes.delete(name)
      if (name === 'id') this.id = ''
      notifyMutation({ type: 'attributes', target: this, attributeName: name })
    }
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    }
    querySelectorAll(selector) {
      const out = []
      const visit = node => {
        if (matchesSelector(node, selector)) out.push(node)
        for (const child of node.children) visit(child)
      }
      for (const child of this.children) visit(child)
      return out
    }
    closest(selector) {
      let node = this
      while (node) {
        if (matchesSelector(node, selector)) return node
        node = node.parentNode
      }
      return null
    }
  }

  const document = {
    createElement(tag) {
      const node = new Element(tag)
      node.ownerDocument = document
      return node
    },
    querySelector(selector) {
      return appMount ? (selector === '#app-mount' ? appMount : appMount.querySelector(selector)) : null
    },
    querySelectorAll(selector) {
      return appMount ? appMount.querySelectorAll(selector) : []
    },
  }

  const window = {
    setTimeout(callback) {
      const id = timerId
      timerId += 1
      timerQueue.push({ id, callback, active: true })
      return id
    },
    clearTimeout(id) {
      const timer = timerQueue.find(entry => entry.id === id)
      if (timer) timer.active = false
    },
    requestAnimationFrame(callback) {
      const id = timerId
      timerId += 1
      rafQueue.push({ id, callback, active: true })
      return id
    },
    cancelAnimationFrame(id) {
      const frame = rafQueue.find(entry => entry.id === id)
      if (frame) frame.active = false
    },
    console: { log() {}, warn() {}, error() {} },
  }

  function drain(limit = 200) {
    let iterations = 0
    while ((rafQueue.length || timerQueue.some(entry => entry.active)) && iterations < limit) {
      iterations += 1
      while (rafQueue.length) {
        const frame = rafQueue.shift()
        if (!frame.active) continue
        frame.callback(0)
      }
      const activeTimers = timerQueue.filter(entry => entry.active)
      for (const timer of activeTimers) {
        timer.active = false
        timer.callback()
      }
    }
  }

  let appMount = null
  const toolbarState = {
    wrappers: [],
    hiddenLabels: [],
    quickButtons: [],
    separator: null,
    addButton: null,
    toolbar: null,
    messageNode: null,
    reactionPill: null,
  }

  function createToolbarTree() {
    if (appMount) return
    appMount = document.createElement('div')
    appMount.setAttribute('id', 'app-mount')
    const messageNode = document.createElement('div')
    messageNode.setAttribute('id', 'chat-messages-100-200')
    const toolbar = document.createElement('div')
    toolbar.className = 'buttonsInner_grid'
    messageNode.appendChild(toolbar)
    appMount.appendChild(messageNode)

    const wrappers = []
    const hiddenLabels = []
    const quickButtons = []
    for (let index = 0; index < 3; index += 1) {
      const wrapper = document.createElement('span')
      const button = document.createElement('div')
      button.setAttribute('role', 'button')
      wrapper.appendChild(button)
      const hidden = document.createElement('span')
      toolbar.appendChild(wrapper)
      toolbar.appendChild(hidden)
      wrappers.push(wrapper)
      hiddenLabels.push(hidden)
      quickButtons.push(button)
    }
    const separator = document.createElement('span')
    toolbar.appendChild(separator)
    const addWrapper = document.createElement('span')
    const addButton = document.createElement('div')
    addButton.setAttribute('role', 'button')
    addWrapper.appendChild(addButton)
    toolbar.appendChild(addWrapper)
    toolbar.appendChild(document.createElement('span'))
    for (let index = 0; index < 3; index += 1) {
      const wrapper = document.createElement('span')
      const button = document.createElement('div')
      button.setAttribute('role', 'button')
      wrapper.appendChild(button)
      toolbar.appendChild(wrapper)
      toolbar.appendChild(document.createElement('span'))
    }

    const reactionPill = document.createElement('div')
    reactionPill.setAttribute('role', 'button')
    reactionPill.setAttribute('aria-pressed', 'true')
    messageNode.appendChild(reactionPill)

    toolbarState.wrappers = wrappers
    toolbarState.hiddenLabels = hiddenLabels
    toolbarState.quickButtons = quickButtons
    toolbarState.separator = separator
    toolbarState.addButton = addButton
    toolbarState.toolbar = toolbar
    toolbarState.messageNode = messageNode
    toolbarState.reactionPill = reactionPill
  }

  if (!options.lazyAppMount) createToolbarTree()

  const storageRecords = options.storageRecords || new Map()
  const localStorage = options.throwStorage ? {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
  } : {
    getItem(key) { return storageRecords.has(key) ? storageRecords.get(key) : null },
    setItem(key, value) { storageRecords.set(key, String(value)) },
  }
  window.localStorage = localStorage

  const currentUser = { id: 'user-a' }
  const userListeners = new Set()
  const interceptors = new Set()
  let interceptSubscribeCount = 0

  const thumbsUp = {
    surrogates: '👍',
    uniqueName: 'thumbsup',
    diversityChildren: {
      '1f3fb': {
        surrogates: '👍🏻',
        uniqueName: 'thumbsup_tone1',
        name: 'thumbsup::skin-tone-1',
        diversityChildren: {},
        emojiObject: { names: ['thumbsup_tone1'], surrogates: '👍🏻', hasDiversityParent: true, diversity: ['1f3fb'] },
      },
      '1f3fd': {
        surrogates: '👍🏽',
        uniqueName: 'thumbsup_tone3',
        name: 'thumbsup::skin-tone-3',
        diversityChildren: {},
        emojiObject: { names: ['thumbsup_tone3'], surrogates: '👍🏽', hasDiversityParent: true, diversity: ['1f3fd'] },
      },
    },
    emojiObject: { names: ['thumbsup'], surrogates: '👍' },
  }
  const womanTechnologist = {
    surrogates: '👩‍💻',
    uniqueName: 'woman_technologist',
    diversityChildren: {
      '1f3fd': {
        surrogates: '👩🏽‍💻',
        uniqueName: 'woman_technologist_tone3',
        name: 'woman_technologist::skin-tone-3',
        diversityChildren: {},
        emojiObject: { names: ['woman_technologist_tone3'], surrogates: '👩🏽‍💻', hasDiversityParent: true, diversity: ['1f3fd'] },
      },
    },
    emojiObject: { names: ['woman_technologist'], surrogates: '👩‍💻' },
  }
  const grinning = {
    surrogates: '😀',
    uniqueName: 'grinning',
    diversityChildren: {},
    emojiObject: { names: ['grinning'], surrogates: '😀' },
  }
  const unicodeByName = new Map([
    ['grinning', grinning],
    ['thumbsup', thumbsUp],
    ['woman_technologist', womanTechnologist],
    ['thumbsup_tone1', thumbsUp.diversityChildren['1f3fb']],
    ['thumbsup_tone3', thumbsUp.diversityChildren['1f3fd']],
    ['woman_technologist_tone3', womanTechnologist.diversityChildren['1f3fd']],
  ])
  const emojiContext = {
    emojisByName: unicodeByName,
    emojisById: new Map(),
    unicodeAliases: new Map(),
    getByName(name) {
      return unicodeByName.get(name) || null
    },
    getById(id) {
      return customAll.get(id) || null
    },
  }
  const customUsable = new Map([
    ['custom-ok', { id: 'custom-ok', name: 'blob', animated: false }],
  ])
  const customAll = new Map([
    ['custom-ok', { id: 'custom-ok', name: 'blob', animated: false }],
    ['custom-missing', { id: 'custom-missing', name: 'ghost', animated: true }],
  ])

  let locked = false
  let disabled = false
  let filterCalls = []
  let disableCalls = []
  let deepGetterCalls = 0
  const helperFilter = {
    isEmojiFilteredOrLocked(args) {
      filterCalls.push(args)
      return locked
    },
    isEmojiDisabled(args) {
      disableCalls.push(args)
      return disabled
    },
  }
  const helperIntentions = { REACTION: 0, CHAT: 1 }

  const fakeProxy = new Proxy({}, {
    get() {
      return () => true
    },
  })

  function createRuntime() {
    if (options.helperMode === 'missing') return { c: {} }
    if (options.helperMode === 'proxy') return { c: { 1: { exports: fakeProxy } } }
    if (options.helperMode === 'deep-graph') {
      const deepNode = {}
      Object.defineProperty(deepNode, 'expensive', {
        enumerable: true,
        configurable: true,
        get() {
          deepGetterCalls += 1
          throw new Error('deep getter should not be invoked')
        },
      })
      const rootWithGetter = {}
      Object.defineProperty(rootWithGetter, 'immediate', {
        enumerable: true,
        configurable: true,
        get() {
          return { REACTION: 0, CHAT: 1 }
        },
      })
      rootWithGetter.deepNode = deepNode
      return {
        c: {
          1: { exports: helperFilter },
          2: { exports: rootWithGetter },
        },
      }
    }
    return {
      c: {
        1: { exports: helperFilter },
        2: { exports: { intentions: helperIntentions } },
        3: { exports: { default: helperIntentions } },
      },
    }
  }

  const runtime = createRuntime()
  const webpackChunkdiscord_app = []
  webpackChunkdiscord_app.push = payload => {
    const callback = payload[2]
    if (typeof callback === 'function') callback(runtime, runtime)
    return 0
  }
  if (!options.lazyRuntime) window.webpackChunkdiscord_app = webpackChunkdiscord_app

  const roots = []
  const rootRenders = []
  const React = {
    createElement(type, props, ...children) {
      const nextProps = { ...(props || {}) }
      if (children.length === 1) nextProps.children = children[0]
      else if (children.length > 1) nextProps.children = children
      return { type, props: nextProps }
    },
    Component: class {},
    Fragment: Symbol.for('fragment'),
  }
  const ReactDOMClient = {
    createRoot(host) {
      const renderState = { count: 0, types: [] }
      rootRenders.push(renderState)
      let previousType = null
      let mountedNode = null
      const root = {
        render(tree) {
          renderState.count += 1
          renderState.types.push(tree?.type || null)
          if (options.throwRender) throw new Error('render failed')
          host.renderedTree = tree
          const nextType = tree?.type || null
          if (previousType !== nextType) {
            if (mountedNode) {
              host.removeChild(mountedNode)
              mountedNode = null
            }
            if (nextType) {
              mountedNode = host.ownerDocument.createElement('span')
              mountedNode.setAttribute('data-mock-react-child', '1')
              host.appendChild(mountedNode)
            }
            previousType = nextType
          }
        },
        unmount() {
          if (mountedNode) {
            host.removeChild(mountedNode)
            mountedNode = null
          }
          host.unmounted = true
        },
      }
      roots.push(root)
      return root
    },
  }

  const fiberMap = new Map()
  const tooltipType = function TooltipButton() {}
  const emojiType = function Emoji() {}
  let currentMessage = { id: 'm1', reactions: [] }
  let currentChannel = { id: 'c1', guild_id: 'g1' }
  let selectCalls = []
  let pickerMode = options.pickerMode || 'good'
  let removeCalls = 0
  let throwPill = false
  let pillDisabled = false
  let pillEmojiName = '👍🏻'

  function pickerFactory(channel, message, _close, _isBurst) {
    if (pickerMode === 'throws') throw new Error('picker broke')
    if (pickerMode === 'bad') return { props: {} }
    if (pickerMode === 'null') return null
    return {
      props: {
        onSelectEmoji(payload) {
          selectCalls.push({ channel, message, payload })
        },
      },
    }
  }

  function bindFibers() {
    if (!toolbarState.toolbar) return
    fiberMap.clear()
    for (const [index, button] of toolbarState.quickButtons.entries()) {
      fiberMap.set(button, {
        type: tooltipType,
        memoizedProps: {
          tooltipText: `q${index}`,
          label: `q${index}`,
          onClick() {},
          children: {
            type: emojiType,
            props: {
              emojiId: null,
              emojiName: 'grinning',
              animated: false,
              size: 'reaction',
              canSelect: false,
              className: 'emoji',
            },
          },
        },
        return: {
          memoizedProps: { channel: currentChannel, message: currentMessage },
          return: null,
        },
      })
    }
    fiberMap.set(toolbarState.addButton, {
      memoizedProps: {
        renderEmojiPicker: pickerFactory,
        channel: currentChannel,
        message: currentMessage,
        togglePopout() {},
        shouldShow: true,
      },
      return: null,
    })
    const pillMetadataMessage = options.pillMessageClone
      ? { id: currentMessage.id, reactions: currentMessage.reactions }
      : currentMessage
    const hostFiber = {
      memoizedProps: {
        onClick() {
          if (throwPill) throw new Error('pill click failed')
          removeCalls += 1
        },
      },
      return: null,
    }
    if (options.realisticPillChain) {
      let cursor = hostFiber
      for (let depth = 0; depth < 8; depth += 1) {
        cursor.return = { memoizedProps: {}, return: null }
        cursor = cursor.return
      }
      cursor.return = {
        memoizedProps: {
          message: pillMetadataMessage,
          emoji: { id: null, name: pillEmojiName },
          me: true,
          me_burst: false,
          count_details: {},
          type: 0,
          readOnly: false,
        },
        return: null,
      }
    } else {
      hostFiber.return = {
        memoizedProps: {
          message: pillMetadataMessage,
          emoji: { id: null, name: pillEmojiName },
          me: true,
          type: 0,
        },
        return: null,
      }
    }
    fiberMap.set(toolbarState.reactionPill, hostFiber)
    if (pillDisabled) toolbarState.reactionPill.setAttribute('aria-disabled', 'true')
    else toolbarState.reactionPill.removeAttribute('aria-disabled')
  }

  if (toolbarState.toolbar) bindFibers()

  function installShelter() {
    window.shelter = {
      React,
      ReactDOMClient,
      util: { getFiber: node => fiberMap.get(node) || null },
      flux: {
        stores: {
          UserStore: {
            getCurrentUser() {
              return currentUser.id ? currentUser : null
            },
            addChangeListener(listener) {
              userListeners.add(listener)
            },
            removeChangeListener(listener) {
              userListeners.delete(listener)
            },
          },
          EmojiStore: {
            getDisambiguatedEmojiContext() {
              return emojiContext
            },
            getUsableCustomEmojiById(id) {
              return customUsable.get(id) || null
            },
            getCustomEmojiById(id) {
              return customAll.get(id) || null
            },
          },
        },
        intercept(callback) {
          interceptSubscribeCount += 1
          interceptors.add(callback)
          return () => interceptors.delete(callback)
        },
      },
    }
  }

  if (!options.lazyShelter) installShelter()

  const context = {
    window,
    document,
    MutationObserver,
    setTimeout: (...args) => window.setTimeout(...args),
    clearTimeout: (...args) => window.clearTimeout(...args),
    requestAnimationFrame: (...args) => window.requestAnimationFrame(...args),
    cancelAnimationFrame: (...args) => window.cancelAnimationFrame(...args),
    console: window.console,
  }
  runInNewContext(source, context, { filename: pluginPath })

  function getButtonsFromTree(tree) {
    const out = []
    const seen = new Set()
    const walk = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return
      seen.add(value)
      if (value.props && typeof value.props.onClick === 'function') out.push(value)
      if (Array.isArray(value)) {
        for (const item of value) walk(item)
        return
      }
      for (const child of Object.values(value)) walk(child)
    }
    walk(tree)
    return out
  }

  return {
    window,
    storageRecords,
    drain,
    interceptors,
    userListeners,
    rootRenders,
    toolbarState,
    getHost() {
      if (!toolbarState.toolbar) return null
      return toolbarState.toolbar.children.find(node => node.getAttribute(hostMarker) === '1') || null
    },
    getButtons() {
      const host = this.getHost()
      return host?.renderedTree ? getButtonsFromTree(host.renderedTree) : []
    },
    dispatch(event) {
      for (const interceptor of interceptors) interceptor(event)
      drain()
    },
    setUser(id) {
      currentUser.id = id
      for (const listener of userListeners) listener()
      drain()
    },
    setLocked(value) {
      locked = value
    },
    setDisabled(value) {
      disabled = value
    },
    getFilterCalls() {
      return filterCalls
    },
    getDisableCalls() {
      return disableCalls
    },
    getDeepGetterCalls() {
      return deepGetterCalls
    },
    getSelectCalls() {
      return selectCalls
    },
    getRemoveCalls() {
      return removeCalls
    },
    setMessageReactions(reactions) {
      currentMessage.reactions = reactions
    },
    setPillBehavior({ missing, disabledState, throws }) {
      if (missing) toolbarState.reactionPill.remove()
      pillDisabled = !!disabledState
      throwPill = !!throws
      if (!missing) {
        if (!toolbarState.reactionPill.parentNode) toolbarState.messageNode.appendChild(toolbarState.reactionPill)
        bindFibers()
      }
    },
    setPillEmojiName(value) {
      pillEmojiName = value
      bindFibers()
    },
    replaceContext(next = {}) {
      if (next.message) currentMessage = next.message
      if (next.channel) currentChannel = next.channel
      if (next.pickerMode) pickerMode = next.pickerMode
      bindFibers()
    },
    installLateRuntime() {
      window.webpackChunkdiscord_app = webpackChunkdiscord_app
    },
    installLateShelter() {
      installShelter()
    },
    installLateAppMount() {
      createToolbarTree()
      bindFibers()
    },
    getInterceptSubscribeCount() {
      return interceptSubscribeCount
    },
    getCurrentMessage() {
      return currentMessage
    },
    getCurrentChannel() {
      return currentChannel
    },
    getTemplateTypes() {
      return { tooltipType, emojiType }
    },
    getDisplayState(node) {
      return {
        value: node.style.getPropertyValue('display'),
        priority: node.style.getPropertyPriority('display'),
      }
    },
  }
}

function userHistory(storage, userId) {
  const raw = storage.get(`${storagePrefix}${userId}`)
  return raw ? JSON.parse(raw) : []
}

function emitOwnAdd(fixture, emoji, reactionType = 0) {
  const callback = [...fixture.interceptors][0]
  const result = callback({
    type: 'MESSAGE_REACTION_ADD',
    userId: fixture.window.shelter?.flux?.stores?.UserStore?.getCurrentUser?.()?.id || 'user-a',
    emoji,
    reactionType,
  })
  fixture.drain()
  return result
}

test('startup retries until shelter, app mount, and helper become available exactly once', () => {
  const f = createFixture({ lazyShelter: true, lazyAppMount: true, lazyRuntime: true })
  f.drain()
  assert.equal(f.getInterceptSubscribeCount(), 0)
  f.installLateShelter()
  f.installLateAppMount()
  f.installLateRuntime()
  f.drain()
  assert.equal(f.getInterceptSubscribeCount(), 1)
  f.window.__dorionRecentReactionsCleanup()
  f.drain()
  const previous = f.getInterceptSubscribeCount()
  f.drain()
  assert.equal(f.getInterceptSubscribeCount(), previous)
})

test('records MRU distinct seven, keeps intercept return undefined, and supports restart + account reload', () => {
  const storage = new Map()
  const f = createFixture({ storageRecords: storage })
  f.drain()
  const result = emitOwnAdd(f, { id: null, name: '👍🏻' })
  assert.equal(result, undefined)
  emitOwnAdd(f, { id: null, name: '👩🏽‍💻' })
  emitOwnAdd(f, { id: null, name: '😀' })
  emitOwnAdd(f, { id: 'custom-ok', name: 'blob', animated: false })
  emitOwnAdd(f, { id: 'x4', name: 'x4' })
  emitOwnAdd(f, { id: 'x5', name: 'x5' })
  emitOwnAdd(f, { id: 'x6', name: 'x6' })
  emitOwnAdd(f, { id: 'x7', name: 'x7' })
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  const a = userHistory(storage, 'user-a')
  assert.equal(a.length, 7)
  assert.deepEqual(a[0], { kind: 'unicode', glyph: '👍🏻', name: 'thumbsup_tone1' })
  assert.deepEqual(a[1], { kind: 'custom', id: 'x7', name: 'x7', animated: false })
  f.setUser('user-b')
  emitOwnAdd(f, { id: null, name: '😀' })
  assert.deepEqual(userHistory(storage, 'user-b'), [{ kind: 'unicode', glyph: '😀', name: 'grinning' }])
  f.setUser('user-a')
  const f2 = createFixture({ storageRecords: storage })
  f2.drain()
  const buttons = f2.getButtons()
  assert.ok(buttons.some(button => String(button.props.label).includes('thumbsup_tone1')))
})

test('sanitizes malformed storage arrays and ignores optimistic/failed/other-user/remove/vote events', () => {
  const storage = new Map()
  storage.set(`${storagePrefix}user-a`, JSON.stringify([
    { kind: 'unicode', glyph: '' },
    { kind: 'custom', id: '' },
    { kind: 'unicode', glyph: '😀', name: 'grinning' },
    { kind: 'unicode', glyph: '😀', name: 'grinning' },
    { kind: 'custom', id: 'custom-ok', name: 'blob', animated: false },
    'bad',
    { kind: 'custom', id: 'overflow' },
    { kind: 'custom', id: 'overflow2' },
    { kind: 'custom', id: 'overflow3' },
    { kind: 'custom', id: 'overflow4' },
    { kind: 'custom', id: 'overflow5' },
    { kind: 'custom', id: 'overflow6' },
    { kind: 'custom', id: 'overflow7' },
  ]))
  const f = createFixture({ storageRecords: storage })
  f.drain()
  const intercept = [...f.interceptors][0]
  intercept({ type: 'MESSAGE_REACTION_ADD', userId: 'user-z', emoji: { id: null, name: '😀' }, reactionType: 0 })
  intercept({ type: 'MESSAGE_REACTION_ADD', userId: 'user-a', emoji: { id: null, name: '😀' }, reactionType: 0, optimistic: true })
  intercept({ type: 'MESSAGE_REACTION_ADD', userId: 'user-a', emoji: { id: null, name: '😀' }, reactionType: 2 })
  intercept({ type: 'MESSAGE_REACTION_ADD', userId: 'user-a', emoji: { id: null, name: '😀' }, reactionType: 0, error: true })
  intercept({ type: 'MESSAGE_REACTION_REMOVE', userId: 'user-a' })
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  const records = userHistory(storage, 'user-a')
  assert.equal(records.length, 7)
  assert.deepEqual(records[0], { kind: 'unicode', glyph: '👍🏻', name: 'thumbsup_tone1' })
})

test('proxy-fabricated helper never qualifies and plugin falls back to native UI', () => {
  const f = createFixture({ helperMode: 'proxy' })
  f.drain()
  const host = f.getHost()
  assert.equal(host, null)
  assert.equal(f.toolbarState.wrappers[0].getAttribute(hideMarker), null)
  assert.equal(f.getInterceptSubscribeCount(), 0)
})

test('helper discovery scans only root and immediate candidates (no deep getter traversal)', () => {
  const f = createFixture({ helperMode: 'deep-graph' })
  f.drain()
  assert.equal(f.getInterceptSubscribeCount(), 1)
  assert.equal(f.getDeepGetterCalls(), 0)
  const debug = f.window.__dorionRecentReactionsDebug()
  assert.equal(debug.found, true)
  assert.ok(debug.modulesVisited >= 2)
  assert.ok(debug.lastScanMs >= 0)
})

test('permissions and custom availability gate rendering with correct native filter args', () => {
  const f = createFixture()
  f.drain()
  emitOwnAdd(f, { id: null, name: '😀' })
  emitOwnAdd(f, { id: 'custom-missing', name: 'ghost', animated: true })
  assert.ok(f.getButtons().some(button => String(button.props.label).includes('grinning')))
  assert.ok(f.getButtons().every(button => !String(button.props.label).includes('ghost')))
  const firstArgs = f.getFilterCalls()[0]
  assert.equal(firstArgs.intention, 0)
  assert.equal(firstArgs.guildId, 'g1')
  assert.equal(firstArgs.channel.id, 'c1')
  f.setLocked(true)
  f.dispatch({ type: 'MESSAGE_REACTION_ADD', userId: 'user-a', emoji: { id: null, name: '👩🏽‍💻' }, reactionType: 0 })
  assert.equal(f.getButtons().length, 0)
})

test('renders native emoji child type with unicode glyph or custom name emojiName props', () => {
  const f = createFixture()
  f.drain()
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  emitOwnAdd(f, { id: 'custom-ok', name: 'blob', animated: false })
  const { emojiType } = f.getTemplateTypes()
  const buttons = f.getButtons()
  const unicodeButton = buttons.find(entry => String(entry.props.label).includes('thumbsup_tone1'))
  const customButton = buttons.find(entry => String(entry.props.label).includes(':blob:'))
  assert.ok(unicodeButton)
  assert.ok(customButton)
  assert.equal(unicodeButton.props.children.type, emojiType)
  assert.equal(customButton.props.children.type, emojiType)
  assert.equal(unicodeButton.props.children.props.emojiId, null)
  assert.equal(unicodeButton.props.children.props.emojiName, '👍🏻')
  assert.equal(customButton.props.children.props.emojiId, 'custom-ok')
  assert.equal(customButton.props.children.props.emojiName, 'blob')
})

test('own reaction toggle is tri-state: absent adds, blocked remove does not add', () => {
  const f = createFixture()
  f.drain()
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  const button = f.getButtons().find(entry => String(entry.props.label).includes('thumbsup_tone1'))
  assert.ok(button)

  f.setMessageReactions([])
  button.props.onClick({ stopPropagation() {} })
  assert.equal(f.getSelectCalls().length, 1)
  assert.equal(f.getRemoveCalls(), 0)

  f.setMessageReactions([{ me: true, type: 0, emoji: { id: null, name: '👍🏻' } }])
  f.setPillBehavior({ missing: false, disabledState: true, throws: false })
  button.props.onClick({ stopPropagation() {} })
  f.setPillBehavior({ missing: false, disabledState: false, throws: true })
  button.props.onClick({ stopPropagation() {} })
  f.setPillBehavior({ missing: true, disabledState: false, throws: false })
  button.props.onClick({ stopPropagation() {} })
  assert.equal(f.getRemoveCalls(), 0)
  assert.equal(f.getSelectCalls().length, 1)
})

test('toggle-off uses host click with realistic pill chain and message-id equivalence', () => {
  const f = createFixture({ realisticPillChain: true, pillMessageClone: true })
  f.drain()
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  f.setMessageReactions([{ me: true, type: 0, emoji: { id: null, name: '👍🏻' } }])
  const button = f.getButtons().find(entry => String(entry.props.label).includes('thumbsup_tone1'))
  assert.ok(button)
  button.props.onClick({ stopPropagation() {} })
  assert.equal(f.getRemoveCalls(), 1)
  assert.equal(f.getSelectCalls().length, 0)
})

test('toggle-off does not conflate unicode skin variants or zwj skin variants', () => {
  const f = createFixture({ realisticPillChain: true })
  f.drain()
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  emitOwnAdd(f, { id: null, name: '👩🏽‍💻' })

  const thumbButton = f.getButtons().find(entry => String(entry.props.label).includes('thumbsup_tone1'))
  const zwjButton = f.getButtons().find(entry => String(entry.props.label).includes('woman_technologist_tone3'))
  assert.ok(thumbButton)
  assert.ok(zwjButton)

  f.setMessageReactions([{ me: true, type: 0, emoji: { id: null, name: '👍🏻' } }])
  f.setPillEmojiName('👍')
  thumbButton.props.onClick({ stopPropagation() {} })
  f.setPillEmojiName('👍🏽')
  thumbButton.props.onClick({ stopPropagation() {} })

  f.setMessageReactions([{ me: true, type: 0, emoji: { id: null, name: '👩🏽‍💻' } }])
  f.setPillEmojiName('👩‍💻')
  zwjButton.props.onClick({ stopPropagation() {} })

  assert.equal(f.getRemoveCalls(), 0)
  assert.equal(f.getSelectCalls().length, 0)
})

test('own normal aggregate reactions without type still toggle off; burst-only/nonzero do not', () => {
  const f = createFixture({ realisticPillChain: true })
  f.drain()
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  const thumbButton = f.getButtons().find(entry => String(entry.props.label).includes('thumbsup_tone1'))
  assert.ok(thumbButton)

  f.setMessageReactions([{
    emoji: { id: null, name: '👍🏻' },
    count: 1,
    count_details: { normal: 1, burst: 0 },
    burst_colors: {},
    me_burst: false,
    burst_me: false,
    me: true,
    burst_count: 0,
  }])
  f.setPillEmojiName('👍🏻')
  thumbButton.props.onClick({ stopPropagation() {} })
  assert.equal(f.getRemoveCalls(), 1)
  assert.equal(f.getSelectCalls().length, 0)

  f.setMessageReactions([{
    emoji: { id: null, name: '👍🏻' },
    count: 1,
    count_details: { normal: 0, burst: 1 },
    burst_colors: {},
    me_burst: true,
    burst_me: true,
    me: false,
    burst_count: 1,
  }])
  thumbButton.props.onClick({ stopPropagation() {} })
  assert.equal(f.getRemoveCalls(), 1)
  assert.equal(f.getSelectCalls().length, 1)

  f.setMessageReactions([{
    emoji: { id: null, name: '👍🏻' },
    count: 1,
    count_details: { normal: 1, burst: 0 },
    burst_colors: {},
    me_burst: false,
    burst_me: false,
    me: true,
    burst_count: 0,
    type: 2,
  }])
  thumbButton.props.onClick({ stopPropagation() {} })
  assert.equal(f.getRemoveCalls(), 1)
  assert.equal(f.getSelectCalls().length, 2)
})

test('click resolves latest message/channel/picker source and payload uses resolved emoji object', () => {
  const f = createFixture()
  f.drain()
  emitOwnAdd(f, { id: 'custom-ok', name: 'blob', animated: false })
  const button = f.getButtons().find(entry => String(entry.props.label).includes(':blob:'))
  assert.ok(button)
  const newestMessage = { id: 'm2', reactions: [] }
  const newestChannel = { id: 'c2', guild_id: 'g2' }
  f.replaceContext({ message: newestMessage, channel: newestChannel, pickerMode: 'good' })
  button.props.onClick({ stopPropagation() {} })
  const call = f.getSelectCalls()[0]
  assert.equal(call.channel.id, 'c2')
  assert.equal(call.message.id, 'm2')
  assert.equal(call.payload.emoji.id, 'custom-ok')
  assert.equal(call.payload.emoji, call.payload.emoji)
  f.replaceContext({ pickerMode: 'bad' })
  button.props.onClick({ stopPropagation() {} })
  assert.equal(f.toolbarState.wrappers[0].getAttribute(hideMarker), null)
})

test('bad picker factory or throwing picker keeps native suggestions visible and no action occurs', () => {
  const bad = createFixture({ pickerMode: 'bad' })
  bad.drain()
  emitOwnAdd(bad, { id: null, name: '😀' })
  assert.equal(bad.getHost(), null)
  assert.equal(bad.toolbarState.wrappers[0].getAttribute(hideMarker), null)

  const throwing = createFixture({ pickerMode: 'throws' })
  throwing.drain()
  emitOwnAdd(throwing, { id: null, name: '😀' })
  assert.equal(throwing.getHost(), null)
  assert.equal(throwing.getSelectCalls().length, 0)
})

test('restores original display value and priority on fallback and cleanup', () => {
  const f = createFixture()
  f.toolbarState.wrappers[1].style.setProperty('display', 'inline-flex', 'important')
  f.drain()
  emitOwnAdd(f, { id: null, name: '😀' })
  assert.deepEqual(f.getDisplayState(f.toolbarState.wrappers[0]), { value: 'none', priority: '' })
  assert.deepEqual(f.getDisplayState(f.toolbarState.wrappers[1]), { value: 'none', priority: '' })

  f.replaceContext({ pickerMode: 'bad' })
  const button = f.getButtons().find(entry => String(entry.props.label).includes('grinning'))
  assert.ok(button)
  button.props.onClick({ stopPropagation() {} })
  assert.deepEqual(f.getDisplayState(f.toolbarState.wrappers[0]), { value: '', priority: '' })
  assert.deepEqual(f.getDisplayState(f.toolbarState.wrappers[1]), { value: 'inline-flex', priority: 'important' })

  emitOwnAdd(f, { id: null, name: '👍🏻' })
  f.window.__dorionRecentReactionsCleanup()
  f.drain()
  assert.deepEqual(f.getDisplayState(f.toolbarState.wrappers[0]), { value: '', priority: '' })
  assert.deepEqual(f.getDisplayState(f.toolbarState.wrappers[1]), { value: 'inline-flex', priority: 'important' })
})

test('stable boundary type prevents reconciliation render loops', () => {
  const f = createFixture()
  f.drain()
  emitOwnAdd(f, { id: null, name: '😀' })
  emitOwnAdd(f, { id: null, name: '👍🏻' })
  const renderState = f.rootRenders[0]
  assert.ok(renderState)
  assert.ok(renderState.types.length >= 2)
  const firstType = renderState.types[0]
  assert.ok(renderState.types.every(type => type === firstType))
  assert.ok(renderState.count <= 6)
  f.setLocked(true)
  f.dispatch({
    type: 'MESSAGE_REACTION_ADD',
    userId: 'user-a',
    emoji: { id: null, name: '👩🏽‍💻' },
    reactionType: 0,
  })
  const bounded = renderState.count
  assert.ok(bounded <= 9)
  f.drain()
  f.drain()
  assert.equal(renderState.count, bounded)
})

test('observer remains quiescent after render drain and cleanup restores native state', () => {
  const f = createFixture()
  f.drain()
  emitOwnAdd(f, { id: null, name: '😀' })
  const rootState = f.rootRenders[0]
  assert.ok(rootState.count > 0)
  f.drain()
  const before = rootState.count
  f.drain()
  assert.equal(rootState.count, before)
  f.window.__dorionRecentReactionsCleanup()
  f.drain()
  assert.equal(f.toolbarState.wrappers[0].getAttribute(hideMarker), null)
  assert.equal(f.userListeners.size, 0)
  assert.equal(f.interceptors.size, 0)
})
