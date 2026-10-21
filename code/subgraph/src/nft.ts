import { Transfer } from '../generated/TokenizeArt/TokenizeArt'
import { Nft } from '../generated/schema'

/** NFT가 움직일 때마다 (발행 포함) 주인을 갱신 */
export function handleTransfer(event: Transfer): void {
  const id = event.params.tokenId.toString()
  let nft = Nft.load(id)
  if (nft == null) {
    nft = new Nft(id) // 처음 보는 번호 = 방금 발행된 NFT (from = 0x0)
  }
  nft.owner = event.params.to // [8] 새 주인
  nft.save() // [9] 잊으면 아무것도 기록되지 않음
}
