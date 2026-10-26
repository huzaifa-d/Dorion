import icon from '../../icons/32x32.png'
import css from './titlebar.css'
import { waitForDom } from './util'

const maximizeIcon = '<path d="M3 7V3h4m3 0h4v4m0 3v4h-4m-3 0H3v-4"/>'
const restoreIcon = '<path d="M6 6V3h8v8h-3M3 6h8v8H3z"/>'

export async function installIntegratedTitlebar() {
  await waitForDom()
  if (document.getElementById('discord-integrated-titlebar')) return

  const { invoke } = window.__TAURI__.core
  const appWindow = window.__TAURI__.webviewWindow.getCurrentWebviewWindow()
  const style = document.createElement('style')
  style.textContent = css

  const bar = document.createElement('header')
  bar.id = 'discord-integrated-titlebar'
  bar.setAttribute('aria-label', 'Discord window controls')
  bar.innerHTML = `
    <span class="discord-titlebar-brand">
      <img alt="" draggable="false"><span>Discord</span>
    </span>
    <button type="button" data-action="minimize" aria-label="Minimise" title="Minimise">
      <svg viewBox="0 0 17 17" aria-hidden="true"><path d="M3 8.5h11"/></svg>
    </button>
    <button type="button" data-action="maximize" aria-label="Maximise" title="Maximise">
      <svg viewBox="0 0 17 17" aria-hidden="true">${maximizeIcon}</svg>
    </button>
    <button type="button" data-action="close" aria-label="Close" title="Close">
      <svg viewBox="0 0 17 17" aria-hidden="true"><path d="m3.5 3.5 10 10m0-10-10 10"/></svg>
    </button>`
  bar.querySelector('img')!.src = icon

  const reportError = (error: unknown) => console.error('[Titlebar]', error)
  const maximize = bar.querySelector<HTMLButtonElement>('[data-action="maximize"]')!
  const syncState = async () => {
    const [maximized, fullscreen] = await Promise.all([
      appWindow.isMaximized(),
      appWindow.isFullscreen(),
    ])
    const label = maximized ? 'Restore' : 'Maximise'
    maximize.title = label
    maximize.setAttribute('aria-label', label)
    maximize.querySelector('svg')!.innerHTML = maximized ? restoreIcon : maximizeIcon
    document.documentElement.toggleAttribute(
      'data-discord-fullscreen',
      fullscreen || !!document.fullscreenElement
    )
  }

  bar.addEventListener('click', (event) => {
    const action = (event.target as Element).closest<HTMLButtonElement>('button')?.dataset.action
    const commands: Record<string, string> = {
      minimize: 'minimize',
      maximize: 'toggle_maximize',
      close: 'close',
    }
    if (action && commands[action]) {
      invoke(commands[action]).then(syncState).catch(reportError)
    }
  })
  bar.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    event.preventDefault()
    const action = event.detail === 2
      ? invoke('toggle_maximize').then(syncState)
      : appWindow.startDragging()
    action.catch(reportError)
  })
  const onFullscreen = () => { syncState().catch(reportError) }

  let unlisten: (() => void) | undefined
  try {
    document.head.appendChild(style)
    document.body.prepend(bar)
    // Discord replaces the root class list when applying its theme.
    document.documentElement.setAttribute('data-discord-titlebar', '')
    await syncState()
    unlisten = await appWindow.onResized(() => { syncState().catch(reportError) })
    // Keep native window controls available until the replacement is ready.
    await invoke('set_decorations', { enable: false })
    document.addEventListener('fullscreenchange', onFullscreen)
  } catch (error) {
    unlisten?.()
    bar.remove()
    style.remove()
    document.documentElement.removeAttribute('data-discord-titlebar')
    document.documentElement.removeAttribute('data-discord-fullscreen')
    throw error
  }
}
