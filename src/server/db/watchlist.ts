import { getPool } from "./client";
import type { WatchlistCoin } from "../types";

interface WatchlistRow {
  coin_id: string;
  symbol: string;
  name: string;
  eth_contract_address: string | null;
  bsc_contract_address: string | null;
  active: boolean;
  added_at: string;
}

function toWatchlistCoin(row: WatchlistRow): WatchlistCoin {
  return {
    coinId: row.coin_id,
    symbol: row.symbol,
    name: row.name,
    ethContractAddress: row.eth_contract_address,
    bscContractAddress: row.bsc_contract_address,
    active: row.active,
    addedAt: row.added_at,
  };
}

export async function getWatchlist(
  opts: { activeOnly?: boolean } = {}
): Promise<WatchlistCoin[]> {
  const { activeOnly = true } = opts;
  const res = await getPool().query<WatchlistRow>(
    activeOnly
      ? "SELECT * FROM watchlist WHERE active = true ORDER BY added_at ASC"
      : "SELECT * FROM watchlist ORDER BY added_at ASC"
  );
  return res.rows.map(toWatchlistCoin);
}

export async function addToWatchlist(input: {
  coinId: string;
  symbol: string;
  name: string;
  ethContractAddress?: string | null;
  bscContractAddress?: string | null;
}): Promise<WatchlistCoin> {
  const res = await getPool().query<WatchlistRow>(
    `INSERT INTO watchlist (coin_id, symbol, name, eth_contract_address, bsc_contract_address)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (coin_id) DO UPDATE SET
       symbol = EXCLUDED.symbol,
       name = EXCLUDED.name,
       eth_contract_address = EXCLUDED.eth_contract_address,
       bsc_contract_address = EXCLUDED.bsc_contract_address,
       active = true
     RETURNING *`,
    [
      input.coinId,
      input.symbol,
      input.name,
      input.ethContractAddress ?? null,
      input.bscContractAddress ?? null,
    ]
  );
  return toWatchlistCoin(res.rows[0]);
}

/** Soft-remove: flips `active` off rather than deleting, to preserve history joins. */
export async function removeFromWatchlist(coinId: string): Promise<void> {
  await getPool().query(
    "UPDATE watchlist SET active = false WHERE coin_id = $1",
    [coinId]
  );
}
