# Hide individual embeds

Optional local plugin for Discord-branded Dorion. Hover or keyboard-focus a
standard link or bot embed and select its **x / Hide embed** button. This works
on other people's messages too, without modifying their messages.

Dismissed embeds disappear without a recovery button or placeholder. Dismissals
survive message remounts and navigation in the current page; reload or restart
restores them all. Gifts, uploaded media/files and original message text/URLs are
left alone. Leave Discord's global embeds setting enabled.

## Install

Copy only the plugin into the local plugins folder:

```powershell
Copy-Item '.\plugins\embed-dismissal\Hide-Embeds.js' `
  "$env:USERPROFILE\dorion\plugins\Hide-Embeds.js"
```

Enable **Hide-Embeds.js** in the client's local plugin settings with **preload
disabled**, then reload the app. Preserve the existing `plugins.json`; do not
replace other registrations. The plugin works independently of Alpine Crimson
and does not require an app rebuild.

To uninstall, disable the plugin and reload, then remove its JavaScript file.
No account settings or server messages are changed.

## Behaviour and limitations

- Native buttons support Enter/Space and visible focus. Dismissal releases focus
  from the hidden preview and returns it to an existing focusable ancestor when
  available. Hidden preview links cannot receive focus.
- Only standard `embedFull_*` and `inlineMediaEmbed_*` roots inside identifiable
  chat messages are handled. Nested media does not get duplicate controls.
- Gift/collectible cards and uploaded-media containers are excluded. Unknown
  layouts and previews inside an enclosing interactive element are left alone.
- For an embed that is itself a link/media element, the close button sits just
  before it instead of being nested inside the interactive content.
- Dismissal uses the message identity and eligible embed position in memory.
  Editing a message to reorder embeds may change which position is hidden.
  Reloading clears all dismissal state.
- The plugin makes no network/API calls, reads no message text and writes no
  dismissal state to storage. It observes DOM changes and uses static class
  names, which may require updating after Discord layout changes.

## Synthetic browser checks

Use the installed `playwright-cli` with an isolated session. From this folder,
serve only the fixture/plugin directory in another terminal:

```powershell
python -m http.server 9038 --bind 127.0.0.1 --directory .
```

Then run:

```powershell
playwright-cli -s=embed-check open 'http://127.0.0.1:9038/' --browser=msedge
$checks = (Get-Content -Raw '.\Hide-Embeds.test.js').Replace('export default ', '')
playwright-cli -s=embed-check run-code $checks
playwright-cli -s=embed-check close
node --check '.\Hide-Embeds.js'
```

The check returns an object whose fields are all `true`; any failure throws an
error. It covers independent dismissal without recovery, keyboard/focus, protected gifts/uploads,
nested and linked previews, delayed/remounted messages, recycled message nodes,
cleanup, reinjection and reload reset. Stop the local server afterwards.
