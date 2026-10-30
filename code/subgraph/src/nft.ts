import { Transfer } from '../generated/TokenizeArt/TokenizeArt'
import { Nft } from '../generated/schema'

/** Update the owner every time an NFT moves (including mints) */
export function handleTransfer(event: Transfer): void {
  const id = event.params.tokenId.toString()
  let nft = Nft.load(id)
  if (nft == null) {
    nft = new Nft(id) // Unseen tokenId = freshly minted NFT (from = 0x0)
  }
  nft.owner = event.params.to // New owner
  nft.save() // Without this, nothing is stored
}
