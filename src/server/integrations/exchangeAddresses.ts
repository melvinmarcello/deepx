/**
 * Best-effort, non-exhaustive set of well-known CEX hot-wallet addresses,
 * used only to classify on-chain flag `direction`. This is NOT a complete
 * list (exchanges rotate/add hot wallets constantly) - anything not
 * matched here falls back to "wallet_to_wallet" rather than guessing.
 * Lower-cased for case-insensitive comparison.
 */
const KNOWN_EXCHANGE_ADDRESSES = new Set(
  [
    // Binance
    "0x28c6c06298d514db089934071355e5743bf21d60",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
    "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
    "0x9696f59e4d72e237be84ffd425dcad154bf96976",
    // Coinbase
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
    "0x503828976d22510aad0201ac7ec88293211d23da",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "0x3cd751e6b0078be393132286c442345e5dc49699",
    // Kraken
    "0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
    "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13",
    "0xe853c56864a2ebe4576a807d26fdc4a0ada51919",
  ].map((a) => a.toLowerCase())
);

export type OnchainDirection = "to_exchange" | "from_exchange" | "wallet_to_wallet";

export function classifyDirection(from: string, to: string): OnchainDirection {
  const fromEx = KNOWN_EXCHANGE_ADDRESSES.has(from.toLowerCase());
  const toEx = KNOWN_EXCHANGE_ADDRESSES.has(to.toLowerCase());
  if (toEx && !fromEx) return "to_exchange";
  if (fromEx && !toEx) return "from_exchange";
  return "wallet_to_wallet";
}
