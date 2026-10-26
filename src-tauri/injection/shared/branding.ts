export async function brandPluginResponse(url: string, response: Response): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return response
  }

  if (
    parsed.origin !== 'https://spikehd.dev' ||
    !/^\/shelter-plugins\/dorion-[\w-]+\/plugin\.(js|json)$/.test(parsed.pathname) ||
    !response.ok
  ) return response

  const source = await response.text()
  // Change the shared backend's display name, not its window.Dorion API or backend keys.
  const branded = source
    .replace(/(\bname\s*:\s*|["']name["']\s*:\s*)(["'])Dorion(?=\2| )/g, '$1$2Discord')
    .replaceAll('Shelter is required for Dorion to function properly.', 'Shelter is required for Discord to function properly.')
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(branded, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
