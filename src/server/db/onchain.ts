import { getPool } from "./client";
import type { OnchainFlag, OnchainDirection } from "../types";

interface OnchainFlagRow {
  id: number;
  coin_id: string;
  chain: string;
  wallet_address: string;
  tx_hash: string;
  usd_value: string | null;
  direction: string | null;
  flagged_at: string;
}

function toOnchainFlag(row: OnchainFlagRow): OnchainFlag {
  return {
    id: row.id,
    coinId: row.coin_id,
    chain: row.chain as "ethereum" | "bsc",
    walletAddress: row.wallet_address,
    txHash: row.tx_hash,
    usdValue: row.usd_value != null ? Number(row.usd_value) : null,
    direction: row.direction as OnchainDirection | string | null,
    flaggedAt: row.flagged_at,
  };
}

export interface InsertOnchainFlagInput {
  coinId: string;
  chain: "ethereum" | "bsc";
  walletAddress: string;
  txHash: string;
  usdValue: number;
  direction: OnchainDirection | string;
}

/** Dedupes on (tx_hash, chain) - returns null if this transfer was already flagged. */
export async function insertOnchainFlag(
  input: InsertOnchainFlagInput
): Promise<OnchainFlag | null> {
  const res = await getPool().query<OnchainFlagRow>(
    `INSERT INTO onchain_flags (coin_id, chain, wallet_address, tx_hash, usd_value, direction)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash, chain) DO NOTHING
     RETURNING *`,
    [
      input.coinId,
      input.chain,
      input.walletAddress,
      input.txHash,
      input.usdValue,
      input.direction,
    ]
  );
  return res.rows[0] ? toOnchainFlag(res.rows[0]) : null;
}

export async function getRecentFlagsForCoin(
  coinId: string,
  sinceHours = 24
): Promise<OnchainFlag[]> {
  const res = await getPool().query<OnchainFlagRow>(
    `SELECT * FROM onchain_flags
     WHERE coin_id = $1 AND flagged_at >= now() - ($2 || ' hours')::interval
     ORDER BY flagged_at DESC`,
    [coinId, sinceHours]
  );
  return res.rows.map(toOnchainFlag);
}

export async function getRecentFlags(limit = 50): Promise<OnchainFlag[]> {
  const res = await getPool().query<OnchainFlagRow>(
    `SELECT * FROM onchain_flags ORDER BY flagged_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map(toOnchainFlag);
}

/** Flag counts per coin in one round-trip, for the screener table. */
export async function getFlagCountsByCoin(sinceHours = 24): Promise<Map<string, number>> {
  const res = await getPool().query<{ coin_id: string; count: string }>(
    `SELECT coin_id, count(*) AS count FROM onchain_flags
     WHERE flagged_at >= now() - ($1 || ' hours')::interval
     GROUP BY coin_id`,
    [sinceHours]
  );
  return new Map(res.rows.map((r) => [r.coin_id, Number(r.count)]));
}
