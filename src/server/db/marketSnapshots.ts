import { getPool } from "./client";
import type { MarketSnapshot } from "../types";

interface MarketSnapshotRow {
  coin_id: string;
  captured_at: string;
  price_usd: string | null;
  market_cap_usd: string | null;
  volume_24h_usd: string | null;
  pct_change_1h: string | null;
  pct_change_24h: string | null;
  pct_change_7d: string | null;
  circulating_supply: string | null;
  total_supply: string | null;
  source_updated_at: string | null;
  symbol: string | null;
  name: string | null;
}

const num = (v: string | null): number | null => (v != null ? Number(v) : null);

/**
 * Persists one row per coin per run. `captured_at` defaults to now(), so each
 * pipeline run appends a new point rather than overwriting - this is what
 * eventually gives the risk agent real volatility history.
 */
export async function insertMarketSnapshots(snapshots: MarketSnapshot[]): Promise<number> {
  if (snapshots.length === 0) return 0;

  const values: unknown[] = [];
  const tuples = snapshots.map((s, i) => {
    const o = i * 10;
    values.push(
      s.coinId,
      s.priceUsd,
      s.marketCapUsd,
      s.volume24hUsd,
      s.priceChangePct1h,
      s.priceChangePct24h,
      s.priceChangePct7d,
      s.circulatingSupply,
      s.totalSupply,
      s.lastUpdated
    );
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9}, $${o + 10})`;
  });

  const res = await getPool().query(
    `INSERT INTO market_snapshots
       (coin_id, price_usd, market_cap_usd, volume_24h_usd, pct_change_1h,
        pct_change_24h, pct_change_7d, circulating_supply, total_supply, source_updated_at)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (coin_id, captured_at) DO NOTHING`,
    values
  );
  return res.rowCount ?? 0;
}

export interface StoredSnapshot {
  snapshot: MarketSnapshot;
  capturedAt: string;
}

/**
 * Most recent stored snapshot per coin. This is the dashboard's source of
 * truth: rendering a page must never depend on an outbound CoinMarketCap
 * call succeeding.
 */
export async function getLatestMarketSnapshots(): Promise<StoredSnapshot[]> {
  const res = await getPool().query<MarketSnapshotRow>(
    `SELECT DISTINCT ON (m.coin_id) m.*, w.symbol, w.name
     FROM market_snapshots m
     JOIN watchlist w ON w.coin_id = m.coin_id
     ORDER BY m.coin_id, m.captured_at DESC`
  );

  return res.rows.map((row) => ({
    capturedAt: row.captured_at,
    snapshot: {
      coinId: row.coin_id,
      symbol: row.symbol ?? row.coin_id,
      name: row.name ?? row.coin_id,
      priceUsd: num(row.price_usd),
      marketCapUsd: num(row.market_cap_usd),
      volume24hUsd: num(row.volume_24h_usd),
      priceChangePct1h: num(row.pct_change_1h),
      priceChangePct24h: num(row.pct_change_24h),
      priceChangePct7d: num(row.pct_change_7d),
      circulatingSupply: num(row.circulating_supply),
      totalSupply: num(row.total_supply),
      ath: null,
      athChangePercentage: null,
      lastUpdated: row.source_updated_at,
      fromCache: true,
    },
  }));
}

/** Average of prior snapshot volumes (excluding the latest) for volume-spike detection. */
export async function getPriorAvgVolumeByCoin(
  lookback = 6
): Promise<Map<string, number>> {
  const res = await getPool().query<{ coin_id: string; avg_vol: string }>(
    `WITH ranked AS (
       SELECT coin_id, volume_24h_usd,
              row_number() OVER (PARTITION BY coin_id ORDER BY captured_at DESC) AS rn
       FROM market_snapshots
       WHERE volume_24h_usd IS NOT NULL
     )
     SELECT coin_id, avg(volume_24h_usd)::text AS avg_vol
     FROM ranked
     WHERE rn BETWEEN 2 AND $1 + 1
     GROUP BY coin_id
     HAVING count(*) >= 1`,
    [lookback]
  );
  return new Map(res.rows.map((r) => [r.coin_id, Number(r.avg_vol)]));
}
