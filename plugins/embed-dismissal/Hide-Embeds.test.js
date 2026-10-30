export default async function checkEmbeds(page) {
  const response = await page.request.get(page.url() + 'Hide-Embeds.js')
  const source = response.ok() ? await response.text() : '// Plugin not installed'
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const fixture = `
    <style>
      body { background: #18121c; color: white; font: 16px sans-serif; }
      .embedFull__623de, .inlineMediaEmbed__623de { margin: 8px; padding: 28px; border: 1px solid #777; width: 360px; }
      a { color: #bda0ff; }
    </style>
    <div id="outside" class="embedFull__623de">Not a chat message</div>
    <div id="app-mount">
      <ol data-list-id="chat-messages">
        <li id="chat-messages-10-101" tabindex="-1">
          <div id="message-content-101">Original message <a id="original-url" href="#original">original URL</a></div>
          <div class="container_b7e1cb">
            <article id="first" class="embedFull__623de">
              First link preview <a id="first-link" href="#first">Open preview</a>
              <div class="inlineMediaEmbed__623de" id="nested">Nested embed media</div>
            </article>
            <article id="second" class="embedFull__623de">Second bot embed <button id="bot-action">Bot action</button></article>
            <div id="gift" class="giftCodeContainer_b7e1cb"><button>Open gift</button></div>
            <div id="custom-gift" class="customGiftEmbedWrapper__353fe">
              <article class="embedFull__623de">Gift-shaped embed <button>Claim</button></article>
            </div>
            <div id="upload" class="imageContent__0f481">
              <div class="inlineMediaEmbed__623de">Uploaded image <button>Open image</button></div>
            </div>
            <div id="file" class="attachment_f1"><button>Download file</button></div>
            <video id="video" controls></video>
            <a id="outer-link" href="#outer"><div class="embedFull__623de">Unknown linked layout</div></a>
          </div>
        </li>
        <li id="chat-messages-10-102">
          <div class="container_b7e1cb">
            <div id="inline" class="inlineMediaEmbed__623de"><button>Play linked video</button></div>
          </div>
        </li>
        <li id="chat-messages-10-103">
          <div class="container_b7e1cb">
            <a id="linked" class="embedFull__623de" href="#provider">Clickable provider embed</a>
          </div>
        </li>
      </ol>
    </div>`
  const hide = '[data-dorion-embed-action="hide"]'
  const show = '[data-dorion-embed-action="show"]'
  const install = () => page.addScriptTag({ content: source })
  const waitForControls = count => page.waitForFunction(
    ({ selector, count }) => document.querySelectorAll(selector).length === count,
    { selector: hide, count },
    { timeout: 5000 },
  )

  await page.setContent(fixture)
  await page.evaluate(() => {
    window.fixtureOriginal = document.querySelector('#chat-messages-10-101').outerHTML
    window.untouched = ['gift', 'custom-gift', 'upload', 'file', 'video', 'outside', 'original-url', 'outer-link']
      .map(id => [id, document.getElementById(id).outerHTML])
    window.bubbled = 0
    document.querySelector('#app-mount').addEventListener('click', () => window.bubbled++)
  })
  await install()
  await waitForControls(4)
  check(await page.locator('#nested ' + hide).count() === 0, 'Nested embed media must not receive another control')
  check(await page.locator('#gift ' + hide + ', #custom-gift ' + hide + ', #upload ' + hide).count() === 0,
    'Gifts and uploads must not receive controls')

  await page.locator('#first ' + hide).focus()
  await page.keyboard.press('Enter')
  check(!await page.locator('#first').isVisible(), 'Enter must hide the chosen incoming preview')
  check(await page.locator('#second').isVisible(), 'Hiding one preview must not hide sibling embeds')
  check(!await page.locator('#first-link').isVisible(), 'Hidden embed links must not remain focusable')
  check(await page.locator(show).count() === 0, 'Dismissed embeds must not leave a recovery control')
  check(await page.evaluate(() => !document.activeElement?.closest('#first')),
    'Keyboard focus must leave the hidden embed')
  check(await page.evaluate(() => document.activeElement?.id) === 'chat-messages-10-101',
    'Dismissal must return focus to an existing focusable message ancestor')
  await page.keyboard.press('Tab')
  check(await page.evaluate(() => !document.activeElement?.closest('#first')), 'Tab must skip hidden embed descendants')

  await page.locator('#second').hover()
  await page.locator('#second ' + hide).click()
  check(await page.locator('[data-dorion-embed-hidden]').count() === 2, 'Multiple embeds must be dismissed independently')
  check(await page.locator(show).count() === 0, 'Multiple dismissals must leave no recovery controls')

  await page.locator('#inline ' + hide).focus()
  await page.keyboard.press('Space')
  check(!await page.locator('#inline').isVisible(), 'Linked media previews must also be dismissible')
  await page.locator('#linked').evaluate(element => element.previousElementSibling.focus())
  await page.keyboard.press('Enter')
  check(!await page.locator('#linked').isVisible(), 'A linked embed root must be dismissible without opening it')
  check(!page.url().includes('#'), 'Controls must not follow embed links')
  check(await page.evaluate(() => window.bubbled) === 0, 'Control clicks must not trigger Discord message actions')
  check(await page.evaluate(() => window.untouched.every(([id, html]) =>
    document.getElementById(id).outerHTML === html)), 'Gifts, uploads and original message URLs must remain untouched')

  await page.evaluate(() => {
    document.querySelector('#chat-messages-10-101').outerHTML = window.fixtureOriginal
  })
  await waitForControls(4)
  check(!await page.locator('#first').isVisible() && !await page.locator('#second').isVisible(),
    'Remount must retain the dismissed embeds in that message without placeholders')

  await page.evaluate(() => {
    const message = document.createElement('li')
    message.id = 'chat-messages-10-104'
    message.innerHTML = '<div id="delayed" class="embedFull__623de">New incoming embed</div>'
    document.querySelector('ol').append(message)
  })
  await waitForControls(5)
  await page.locator('#delayed ' + hide).focus()
  await page.keyboard.press('Enter')
  check(!await page.locator('#delayed').isVisible(), 'Delayed incoming embeds must get working controls')

  await page.evaluate(() => {
    document.querySelector('#chat-messages-10-104').id = 'chat-messages-10-105'
  })
  await page.waitForFunction(() => !document.querySelector('#delayed').hasAttribute('data-dorion-embed-hidden'))
  check(await page.locator('#delayed').isVisible(), 'A recycled message node must not inherit another message dismissal')

  await page.evaluate(() => {
    document.querySelector('#first ' + '[data-dorion-embed-action="hide"]').remove()
  })
  await waitForControls(5)
  check(await page.locator('#first ' + hide).count() === 1, 'Discord rerenders must restore missing controls without duplicates')

  await install()
  await waitForControls(5)
  check(await page.locator('[data-dorion-embed-hidden]').count() === 0, 'Reinjection must clean previous dismissal state')
  check(await page.locator('style[data-dorion-embed-style]').count() === 1, 'Reinjection must leave exactly one owned stylesheet')
  await page.locator('#first ' + hide).focus()
  await page.keyboard.press('Enter')
  await page.evaluate(() => window.__dorionHideEmbedsCleanup())
  check(await page.locator(hide + ', ' + show + ', [data-dorion-embed], [data-dorion-embed-hidden], [data-dorion-embed-position]').count() === 0,
    'Cleanup must remove all owned controls and attributes')
  check(await page.locator('#first').isVisible() && await page.locator('#linked').isVisible(),
    'Cleanup must restore hidden original nodes')
  check(await page.locator('style[data-dorion-embed-style]').count() === 0, 'Cleanup must remove the owned stylesheet')
  check(await page.evaluate(() => document.querySelector('#chat-messages-10-101').outerHTML === window.fixtureOriginal),
    'Cleanup must restore the exact original message markup')
  await page.evaluate(() => document.querySelector('ol').insertAdjacentHTML('beforeend',
    '<li id="chat-messages-10-106"><article class="embedFull__623de">After cleanup</article></li>'))
  await page.waitForTimeout(100)
  check(await page.locator(hide).count() === 0, 'Cleanup must disconnect the mutation observer')

  await install()
  await waitForControls(6)
  await page.locator('#first ' + hide).focus()
  await page.keyboard.press('Enter')
  check(!await page.locator('#first').isVisible(), 'The reload check must start with an actively dismissed embed')
  await page.goto(page.url())
  await page.setContent(fixture)
  await install()
  await waitForControls(4)
  check(await page.locator('[data-dorion-embed-hidden]').count() === 0, 'Fresh page contexts must not retain dismissals')
  check(await page.locator(show).count() === 0, 'Reload must not introduce recovery controls')
  await page.evaluate(() => window.__dorionHideEmbedsCleanup())
  await page.setContent('<div id="placeholder"></div>')
  await install()
  await page.evaluate(markup => { document.body.innerHTML = markup }, fixture)
  await waitForControls(4)
  await page.evaluate(() => window.__dorionHideEmbedsCleanup())
  return {
    isolatedDismissalWithoutRecovery: true,
    giftsAndUploadsUnchanged: true,
    keyboardAndFocus: true,
    nestedAndLinkedEmbeds: true,
    remountAndDelayedMount: true,
    recycledMessageSafety: true,
    cleanupAndReinjection: true,
    reloadReset: true,
  }
}
