import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brandPluginResponse } from './branding.ts'

test('rebrands built-in plugin display names without changing backend contracts', async () => {
  const source = `const api = { name: "Dorion" };
if (window.Dorion) backendName = "Dorion";
const help = "Shelter is required for Dorion to function properly.";`
  const result = await brandPluginResponse(
    'https://spikehd.dev/shelter-plugins/dorion-settings/plugin.js',
    new Response(source),
  )
  const text = await result.text()
  assert.match(text, /name: "Discord"/)
  assert.match(text, /window\.Dorion\) backendName = "Dorion"/)
  assert.match(text, /required for Discord/)
})

test('rebrands plugin metadata and removes stale content headers', async () => {
  const result = await brandPluginResponse(
    'https://spikehd.dev/shelter-plugins/dorion-tray/plugin.json?version=1',
    new Response('{"name":"Dorion Tray","author":"SpikeHD"}', {
      headers: { 'content-type': 'application/json', 'content-length': '42' },
    }),
  )
  assert.deepEqual(await result.json(), { name: 'Discord Tray', author: 'SpikeHD' })
  assert.equal(result.headers.get('content-length'), null)
  assert.equal(result.headers.get('content-type'), 'application/json')
})

test('does not alter messages, third-party plugins, unrelated resources or failed responses', async () => {
  for (const url of [
    'https://discord.com/api/v10/channels/1/messages',
    'https://example.com/shelter-plugins/dorion-settings/plugin.js',
    'https://spikehd.dev/shelter-plugins/other-plugin/plugin.js',
    'https://spikehd.dev/shelter-plugins/dorion-settings/readme.json',
    '/api/messages',
  ]) {
    const response = new Response('{"name":"Dorion"}')
    assert.equal(await brandPluginResponse(url, response), response)
    assert.equal(await response.text(), '{"name":"Dorion"}')
  }
  const failure = new Response('Not found', { status: 404 })
  assert.equal(
    await brandPluginResponse('https://spikehd.dev/shelter-plugins/dorion-settings/plugin.js', failure),
    failure,
  )
})
