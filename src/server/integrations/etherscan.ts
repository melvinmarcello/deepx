import { getEnv } from "../config/env";

export type EtherscanChain = "ethereum" | "bsc";

const CHAIN_IDS: Record<EtherscanChain, number> = { ethereum: 1, bsc: 56 };

export interface TokenTransfer {
  hash: string;
  from: string;
  to: string;
  value: string; // raw integer string - divide by 10^tokenDecimal
  tokenDecimal: string;
  timeStamp: string; // unix seconds, as a string
}

interface EtherscanListResponse {
  status: string; // "1" success, "0" error/no-data
  message: string;
  result: TokenTransfer[] | string;
}

/**
 * Fetches the most recent ERC-20/BEP-20 transfer events for a token
 * contract via Etherscan's unified v2 API (chainid selects the chain - one
 * API key works across both ETH mainnet and BSC). Never throws: returns
 * `[]` on any error so one bad/unreachable contract doesn't stop the
 * On-Chain Agent from checking the rest of the watchlist.
 */
export async function getRecentTokenTransfers(
  chain: EtherscanChain,
  contractAddress: string,
  limit = 25
): Promise<TokenTransfer[]> {
  const env = getEnv();
  const url = new URL(env.ETHERSCAN_BASE_URL);
  url.searchParams.set("chainid", String(CHAIN_IDS[chain]));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "tokentx");
  url.searchParams.set("contractaddress", contractAddress);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", env.ETHERSCAN_API_KEY);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = (await res.json()) as EtherscanListResponse;

    if (json.status !== "1" || !Array.isArray(json.result)) {
      // status "0" + "No transactions found" is a normal empty case, not
      // an error - only warn for anything else.
      if (json.message && !/no transactions found/i.test(json.message)) {
        console.warn(`[etherscan] ${chain} ${contractAddress}: ${json.message}`);
      }
      return [];
    }
    return json.result;
  } catch (err) {
    console.warn(
      `[etherscan] request failed for ${chain} ${contractAddress}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
