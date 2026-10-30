# Recent reactions (local Dorion plugin)

Optional local plugin for Discord-branded Dorion. Copy the script from the
repository root:

```powershell
Copy-Item '.\plugins\recent-reactions\Recent-Reactions.js' `
  "$env:USERPROFILE\dorion\plugins\Recent-Reactions.js"
```

Enable it in the client's local plugin settings with **preload disabled**, then
reload. If editing `$env:USERPROFILE\dorion\plugins\plugins.json` directly, merge
this entry into the existing object; preserve all other registrations:

```json
{
  "Recent-Reactions.js": {
    "name": "Seven recent reactions",
    "enabled": true,
    "preload": false
  }
}
```

## Behavior

- Starts empty on enablement (no seeded/filler emoji)
- Tracks only your confirmed `MESSAGE_REACTION_ADD` events
- Shows up to seven distinct recent reactions (MRU, newest first, reuse moves to front)
- Selecting an existing own reaction again removes it through the native control
- Persists only per-account emoji records in `localStorage`
- No message/channel IDs or contents are stored
- If required native internals are unavailable/corrupt, it falls back to native toolbar safely

## Test command

```powershell
node --test '.\plugins\recent-reactions\Recent-Reactions.test.cjs'
```
