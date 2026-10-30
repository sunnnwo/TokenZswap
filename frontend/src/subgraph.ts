/** Subgraph query URL (Subgraph Studio, BSC testnet chapel) */
export const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest'

/** Send a GraphQL query and return its data. Throws on failure. */
export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }), // request body: query and variables
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`) // server-level error (404, 429, …)

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (json.errors) throw new Error(json.errors[0].message) // GraphQL error (HTTP status is still 200)
  return json.data as T
}
