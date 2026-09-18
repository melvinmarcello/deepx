const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT_UNITS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * Hand-rolled compact currency formatting.
 *
 * `Intl.NumberFormat` with `notation: "compact"` is NOT safe to render on both
 * sides of hydration: Node and the browser ship different ICU versions, which
 * disagree on fraction digits for compact values ($386M vs $386.00M). Since
 * this runs in both a server component and a client component, the formatting
 * has to be deterministic rather than locale-data dependent.
 */
function compactUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  for (const [threshold, suffix] of COMPACT_UNITS) {
    if (abs >= threshold) {
      const scaled = abs / threshold;
      // Keep more precision on small multiples: 1.65B reads better than 2B.
      const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
      let text = scaled.toFixed(decimals);
      // Trim trailing zeros only in the fractional part - a bare "100" must
      // not become "1".
      if (text.includes(".")) text = text.replace(/\.?0+$/, "");
      return `${sign}$${text}${suffix}`;
    }
  }
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.abs(value) < 1000 ? usdFormatter.format(value) : compactUsd(value);
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(0);
}

/** Price formatting that keeps precision on sub-dollar tokens. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return usdFormatter.format(value);
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(3)}`;
}

/** Percentage-point delta vs a benchmark, e.g. "+4.1pp". */
export function formatPp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}pp`;
}

export function formatRatioPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function explorerTxUrl(chain: string, txHash: string): string {
  return chain === "bsc"
    ? `https://bscscan.com/tx/${txHash}`
    : `https://etherscan.io/tx/${txHash}`;
}
