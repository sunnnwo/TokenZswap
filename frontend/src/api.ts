/** Send a request to the cache server (GET by default) and return the JSON. Throws on failure. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)        // common prefix for all cache server routes; init = { method: 'POST' } for actions
  if (!res.ok) throw new Error(`HTTP ${res.status}`) // check for success (200–299)
  return (await res.json()) as T                       // parse the body as JSON
}
