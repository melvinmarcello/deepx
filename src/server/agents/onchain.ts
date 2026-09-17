import { getRecentTokenTransfers } from "../integrations/etherscan";
import { classifyDirection } from "../integrations/exchangeAddresses";
import { insertOnchainFlag } from "../db/onchain";
import { getEnv } from "../config/env";
import type { MarketSnapshot, WatchlistCoin } from "../types";

/**
 * On-Chain Agent - for every watchlist coin with a known ERC-20/BEP-20
 * contract address, pulls the most recent token-transfer events
 * (Etherscan v2 unified API - chainid=1 ETH / chainid=56 BSC) and flags
 * any transfer whose USD value (using the coin's current price from the
 * Market Data Agent) exceeds `ONCHAIN_FLAG_USD_THRESHOLD`. Coins with no
 * contract address (native L1s like BTC/SOL) are skipped - there's no
 * ERC-20/BEP-20 event stream for them on these chains.
 *
 * Direction is best-effort, classified against a small known-exchange
 * address list (see `integrations/exchangeAddresses.ts`).
 */
export async function runOnchainAgent(
  watchlist: WatchlistCoin[],
  snapshots: MarketSnapshot[]
): Promise<{ flagged: number; checked: number }> {
  const threshold = getEnv().ONCHAIN_FLAG_USD_THRESHOLD;
  const priceByCoin = new Map(snapshots.map((s) => [s.coinId, s.priceUsd]));

  let flagged = 0;
  let checked = 0;

  for (const coin of watchlist) {
    const price = priceByCoin.get(coin.coinId);
    if (price == null) continue; // can't compute a USD value without a price

    const chainTargets: { chain: "ethereum" | "bsc"; address: string | null }[] = [
      { chain: "ethereum", address: coin.ethContractAddress },
      { chain: "bsc", address: coin.bscContractAddress },
    ];

    for (const { chain, address } of chainTargets) {
      if (!address) continue;
      checked++;

      const transfers = await getRecentTokenTransfers(chain, address);
      for (const tx of transfers) {
        const decimals = Number(tx.tokenDecimal || "18");
        const amount = Number(tx.value) / 10 ** decimals;
        const usdValue = amount * price;
        if (!Number.isFinite(usdValue) || usdValue < threshold) continue;

        const row = await insertOnchainFlag({
          coinId: coin.coinId,
          chain,
          walletAddress: tx.to,
          txHash: tx.hash,
          usdValue,
          direction: classifyDirection(tx.from, tx.to),
        });
        if (row) flagged++;
      }
    }
  }

  return { flagged, checked };
}
