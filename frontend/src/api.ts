/** Send a GET request to the cache server and return the JSON. Throws on failure. */
export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)              // common prefix for all cache server routes
  if (!res.ok) throw new Error(`HTTP ${res.status}`) // check for success (200–299)
  return (await res.json()) as T                       // parse the body as JSON
}