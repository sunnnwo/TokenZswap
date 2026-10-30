/** 내 캐시 서버에 GET 요청 하나 보내고 JSON을 받아 온다. 실패하면 throw */
export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)              // [1] 모든 캐시 서버 주소의 앞부분
  if (!res.ok) throw new Error(`HTTP ${res.status}`) // [2] 성공(200~299)인지
  return (await res.json()) as T                       // [3] 본문을 JSON으로 읽기
}