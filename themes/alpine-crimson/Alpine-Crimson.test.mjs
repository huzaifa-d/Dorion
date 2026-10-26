import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./Alpine-Crimson.js', import.meta.url), 'utf8')

function fixture() {
  const eventTarget = () => ({
    listeners: new Map(),
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      this.listeners.get(type)?.delete(handler)
    },
    emit(type, event = {}) {
      for (const handler of this.listeners.get(type) || []) handler(event)
    },
  })
  class Element {
    constructor(row = null) {
      this.row = row
      this.style = new Map()
      this.style.setProperty = this.style.set.bind(this.style)
      this.style.removeProperty = this.style.delete.bind(this.style)
      this.attributes = new Map()
    }
    closest(selector) {
      return selector.includes('Alex (direct message)') ? this.row : null
    }
    contains(element) {
      return element === this || element?.row === this
    }
    setAttribute(name, value) {
      this.attributes.set(name, value)
    }
    removeAttribute(name) {
      this.attributes.delete(name)
    }
    getBoundingClientRect() {
      return { left: 80, top: 200, width: 280, height: 40 }
    }
  }
  let currentRow = null
  const document = {
    ...eventTarget(), documentElement: {},
    querySelector: selector => selector.includes('Alex (direct message)') ? currentRow : null,
  }
  const window = eventTarget()
  const observers = []
  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe() { this.connected = true }
    disconnect() { this.connected = false }
  }
  let enabled = true
  const context = {
    window, document, Element, MutationObserver, CSS: { escape: value => value },
    getComputedStyle: () => ({ getPropertyValue: () => enabled ? '1' : '' }),
  }
  const row = new Element()
  row.row = row
  currentRow = row
  const child = new Element(row)
  const move = (target = child, clientX = 110, clientY = 210) =>
    document.emit('pointermove', { target, clientX, clientY })
  const install = () => runInNewContext(source, context)
  install()
  return {
    document, window, row, child, move, install, Element, observers,
    setEnabled: value => { enabled = value },
    replaceRow: value => {
      currentRow = value
      for (const observer of observers.filter(o => o.connected)) observer.callback()
    },
  }
}

test('halo follows pointer coordinates within the row and clears on unrelated targets', () => {
  const f = fixture()
  f.move()
  assert.equal(f.row.style.get('--alpine-halo-x'), '30px')
  assert.equal(f.row.style.get('--alpine-halo-y'), '10px')
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), true)
  f.move(f.child, 220, 225)
  assert.equal(f.row.style.get('--alpine-halo-x'), '140px')
  assert.equal(f.row.style.get('--alpine-halo-y'), '25px')
  f.move(new f.Element())
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), false)
  assert.equal(f.row.style.size, 0)
})

test('moving between row children retains glow; leaving, cancel and blur clear it', () => {
  const f = fixture()
  f.move()
  f.document.emit('pointerout', { relatedTarget: new f.Element(f.row) })
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), true)
  f.document.emit('pointerout', { relatedTarget: new f.Element() })
  assert.equal(f.row.style.size, 0)
  f.move()
  f.document.emit('pointercancel')
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), false)
  f.move()
  f.window.emit('blur')
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), false)
  assert.equal(f.row.style.size, 0)
})

test('companion is inert without the theme and clears an active halo when disabled', () => {
  const f = fixture()
  f.setEnabled(false)
  f.move()
  assert.equal(f.row.style.size, 0)
  f.setEnabled(true)
  f.move()
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), true)
  f.setEnabled(false)
  f.move()
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), false)
  assert.equal(f.row.style.size, 0)
})

test('reinstallation and row replacement leave no stale glow or duplicate listeners', () => {
  const f = fixture()
  f.move()
  f.install()
  assert.equal(f.row.style.size, 0)
  assert.equal(f.document.listeners.get('pointermove').size, 1)
  assert.equal(f.document.listeners.get('pointerout').size, 1)
  assert.equal(f.window.listeners.get('blur').size, 1)
  f.move()
  const replacement = new f.Element()
  f.replaceRow(replacement)
  f.move(new f.Element(replacement))
  assert.equal(f.row.style.size, 0)
  assert.equal(replacement.attributes.has('data-alpine-halo-active'), true)
  f.window.__alpineCrimsonCleanup()
  assert.equal(replacement.style.size, 0)
  assert.equal(f.document.listeners.get('pointermove').size, 0)
  assert.equal(f.window.listeners.get('blur').size, 0)
  assert.equal(replacement.attributes.has('data-alpine-halo-target'), false)
  assert.equal(f.observers.some(observer => observer.connected), false)
})

test('marks the configured row before hover and follows delayed mount and replacement', () => {
  const f = fixture()
  assert.equal(f.row.attributes.has('data-alpine-halo-target'), true)
  f.replaceRow(null)
  assert.equal(f.row.attributes.has('data-alpine-halo-target'), false)
  const replacement = new f.Element()
  f.replaceRow(replacement)
  assert.equal(replacement.attributes.has('data-alpine-halo-target'), true)
  assert.equal(f.row.attributes.has('data-alpine-halo-active'), false)
})
