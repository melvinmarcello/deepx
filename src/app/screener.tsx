"use client";

import { Fragment, useMemo, useState } from "react";
import {
  LIQUIDITY_LABELS,
  SETUP_LABELS,
  TREND_LABELS,
  type LiquidityTier,
  type ScreenerRow,
  type Setup,
} from "@/server/analytics/screener";
import {
  formatPct,
  formatPp,
  formatPrice,
  formatRatioPct,
  formatUsd,
} from "./format";

const TIER_ORDER: LiquidityTier[] = ["illiquid", "thin", "moderate", "good", "deep"];

const SETUP_STYLES: Record<Setup, string> = {
  trend_continuation: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  pullback_entry: "bg-teal-500/10 text-teal-300 ring-teal-500/30",
  extended_wait: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  counter_trend_bounce: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  downtrend_avoid: "bg-red-500/10 text-red-300 ring-red-500/30",
  too_thin: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30",
  no_edge: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30",
};

type SortKey =
  | "conviction"
  | "pct24h"
  | "pct7d"
  | "relStrength24h"
  | "volume24hUsd"
  | "turnover"
  | "riskScore"
  | "floatRatio"
  | "marketCapUsd";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "conviction", label: "Conviction" },
  { key: "relStrength24h", label: "Alpha vs BTC (24h)" },
  { key: "pct24h", label: "24h change" },
  { key: "pct7d", label: "7d change" },
  { key: "volume24hUsd", label: "24h volume" },
  { key: "turnover", label: "Turnover" },
  { key: "riskScore", label: "Risk" },
  { key: "floatRatio", label: "Float" },
  { key: "marketCapUsd", label: "Market cap" },
];

function pctClass(value: number | null): string {
  if (value == null) return "text-zinc-600";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-zinc-400";
}

function riskClass(value: number | null): string {
  if (value == null) return "text-zinc-600";
  if (value >= 60) return "text-red-400";
  if (value >= 35) return "text-amber-400";
  return "text-emerald-400";
}

function confidenceDot(confidence: ScreenerRow["confidence"]): string {
  switch (confidence) {
    case "high":
      return "bg-emerald-400";
    case "medium":
      return "bg-amber-400";
    default:
      return "bg-zinc-600";
  }
}

function ConvictionBar({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-zinc-600">—</span>;
  }
  const tone =
    value >= 65 ? "bg-emerald-400" : value >= 45 ? "bg-teal-400" : value >= 30 ? "bg-amber-400" : "bg-zinc-600";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right font-medium text-zinc-100">{value.toFixed(0)}</span>
    </div>
  );
}

function toCsv(rows: ScreenerRow[]): string {
  const header = [
    "symbol",
    "name",
    "price_usd",
    "pct_1h",
    "pct_24h",
    "pct_7d",
    "alpha_vs_btc_24h",
    "volume_24h_usd",
    "turnover",
    "volume_spike",
    "liquidity_tier",
    "capacity_usd",
    "float_ratio",
    "trend",
    "setup",
    "conviction",
    "risk",
    "confidence",
  ];
  const lines = rows.map((r) =>
    [
      r.symbol,
      `"${r.name}"`,
      r.priceUsd ?? "",
      r.pct1h ?? "",
      r.pct24h ?? "",
      r.pct7d ?? "",
      r.relStrength24h ?? "",
      r.volume24hUsd ?? "",
      r.turnover ?? "",
      r.volumeSpike ?? "",
      r.liquidityTier ?? "",
      r.capacityUsd ?? "",
      r.floatRatio ?? "",
      r.trendState,
      r.setup,
      r.conviction ?? "",
      r.riskScore ?? "",
      r.confidence,
    ].join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export interface ScreenerProps {
  rows: ScreenerRow[];
  rationaleByCoin: Record<string, string>;
}

export function Screener({ rows, rationaleByCoin }: ScreenerProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("conviction");
  const [minTier, setMinTier] = useState<LiquidityTier>("illiquid");
  const [maxRisk, setMaxRisk] = useState(100);
  const [tradableOnly, setTradableOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tierFloor = TIER_ORDER.indexOf(minTier);

    const result = rows.filter((r) => {
      if (q && !r.symbol.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) {
        return false;
      }
      if (r.liquidityTier && TIER_ORDER.indexOf(r.liquidityTier) < tierFloor) return false;
      if (r.riskScore != null && r.riskScore > maxRisk) return false;
      if (tradableOnly) {
        const actionable: Setup[] = ["trend_continuation", "pullback_entry"];
        if (!actionable.includes(r.setup)) return false;
      }
      return true;
    });

    return result.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Risk is the one column where lower is better.
      return sortKey === "riskScore" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, search, sortKey, minTier, maxRisk, tradableOnly]);

  const downloadCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deepx-screener-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-zinc-100">SCREENER</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Ranked by conviction — relative strength, trend alignment, participation, liquidity
            capacity and float quality.
          </p>
        </div>
        <button
          onClick={downloadCsv}
          className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
        >
          Export CSV
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-zinc-800 px-4 py-3 text-xs">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol or name…"
          className="w-44 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
        />

        <label className="flex items-center gap-2 text-zinc-400">
          Min liquidity
          <select
            value={minTier}
            onChange={(e) => setMinTier(e.target.value as LiquidityTier)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-200 outline-none focus:border-zinc-600"
          >
            {[...TIER_ORDER].reverse().map((tier) => (
              <option key={tier} value={tier}>
                {LIQUIDITY_LABELS[tier]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-zinc-400">
          Max risk
          <input
            type="range"
            min={0}
            max={100}
            value={maxRisk}
            onChange={(e) => setMaxRisk(Number(e.target.value))}
            className="w-24 accent-teal-400"
          />
          <span className="w-7 font-medium text-zinc-200">{maxRisk}</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-zinc-400">
          <input
            type="checkbox"
            checked={tradableOnly}
            onChange={(e) => setTradableOnly(e.target.checked)}
            className="accent-teal-400"
          />
          Actionable setups only
        </label>

        <label className="ml-auto flex items-center gap-2 text-zinc-400">
          Sort
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-200 outline-none focus:border-zinc-600"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] font-mono text-sm tabular-nums">
          <thead>
            <tr className="border-b border-zinc-800 font-sans text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="w-8 py-2 pl-4 text-left font-medium">#</th>
              <th className="py-2 text-left font-medium">Coin</th>
              <th className="py-2 pr-3 text-right font-medium">Price</th>
              <th className="py-2 pr-3 text-right font-medium">1h</th>
              <th className="py-2 pr-3 text-right font-medium">24h</th>
              <th className="py-2 pr-3 text-right font-medium">7d</th>
              <th className="py-2 pr-3 text-right font-medium" title="24h return minus BTC's 24h return">
                α vs BTC
              </th>
              <th className="py-2 pr-3 text-right font-medium">24h Vol</th>
              <th className="py-2 pr-3 text-right font-medium" title="24h volume ÷ market cap">
                Turnover
              </th>
              <th
                className="py-2 pr-3 text-right font-medium"
                title="Current 24h volume ÷ average of prior snapshots"
              >
                Vol spike
              </th>
              <th className="py-2 pr-3 text-right font-medium" title="Position size at 1% of one day's volume">
                Capacity
              </th>
              <th className="py-2 pr-3 text-right font-medium" title="Circulating ÷ total supply">
                Float
              </th>
              <th className="py-2 pr-3 text-left font-medium">Setup</th>
              <th className="py-2 pr-3 text-right font-medium">Conviction</th>
              <th className="py-2 pr-4 text-right font-medium">Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={15} className="px-4 py-10 text-center text-sm text-zinc-500">
                  No coins match these filters.
                </td>
              </tr>
            )}

            {filtered.map((r, i) => {
              const isOpen = expanded === r.coinId;
              return (
                <Fragment key={r.coinId}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : r.coinId)}
                    className={`cursor-pointer border-b border-zinc-900 transition hover:bg-zinc-900/60 ${
                      isOpen ? "bg-zinc-900/60" : ""
                    }`}
                  >
                    <td className="py-2.5 pl-4 text-xs text-zinc-600">{i + 1}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${confidenceDot(r.confidence)}`}
                          title={`Data confidence: ${r.confidence}`}
                        />
                        <div className="font-sans">
                          <div className="font-semibold text-zinc-100">{r.symbol}</div>
                          <div className="text-[11px] text-zinc-500">{r.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-zinc-200">{formatPrice(r.priceUsd)}</td>
                    <td className={`py-2.5 pr-3 text-right ${pctClass(r.pct1h)}`}>{formatPct(r.pct1h)}</td>
                    <td className={`py-2.5 pr-3 text-right font-medium ${pctClass(r.pct24h)}`}>
                      {formatPct(r.pct24h)}
                    </td>
                    <td className={`py-2.5 pr-3 text-right ${pctClass(r.pct7d)}`}>{formatPct(r.pct7d)}</td>
                    <td className={`py-2.5 pr-3 text-right ${pctClass(r.relStrength24h)}`}>
                      {formatPp(r.relStrength24h)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-zinc-300">{formatUsd(r.volume24hUsd)}</td>
                    <td className="py-2.5 pr-3 text-right text-zinc-400">{formatRatioPct(r.turnover)}</td>
                    <td
                      className={`py-2.5 pr-3 text-right ${
                        r.volumeSpike != null && r.volumeSpike >= 1.5
                          ? "font-medium text-teal-300"
                          : "text-zinc-400"
                      }`}
                    >
                      {r.volumeSpike != null ? `${r.volumeSpike.toFixed(1)}×` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-zinc-400">
                      {formatUsd(r.capacityUsd)}
                      {r.liquidityTier && (
                        <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                          {LIQUIDITY_LABELS[r.liquidityTier]}
                        </div>
                      )}
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right ${
                        r.floatRatio != null && r.floatRatio < 0.5 ? "text-amber-400" : "text-zinc-400"
                      }`}
                      title={
                        r.floatRatio != null && r.floatRatio < 0.5
                          ? "Low float — future unlocks add sell pressure"
                          : undefined
                      }
                    >
                      {formatRatioPct(r.floatRatio)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                          SETUP_STYLES[r.setup]
                        }`}
                      >
                        {SETUP_LABELS[r.setup]}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <ConvictionBar value={r.conviction} />
                    </td>
                    <td className={`py-2.5 pr-4 text-right font-medium ${riskClass(r.riskScore)}`}>
                      {r.riskScore != null ? r.riskScore.toFixed(0) : "—"}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-zinc-800 bg-zinc-900/30">
                      <td colSpan={15} className="px-4 py-4">
                        <div className="grid gap-6 md:grid-cols-3">
                          <div>
                            <h4 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
                              Conviction breakdown
                            </h4>
                            <ul className="space-y-1.5">
                              {r.convictionParts.map((p) => (
                                <li key={p.label} className="flex items-center gap-2 text-xs">
                                  <span className="w-36 shrink-0 text-zinc-400">{p.label}</span>
                                  <div className="h-1 w-20 overflow-hidden rounded-full bg-zinc-800">
                                    <div
                                      className="h-full rounded-full bg-teal-400"
                                      style={{ width: `${p.value}%` }}
                                    />
                                  </div>
                                  <span className="w-7 text-right text-zinc-200">{p.value}</span>
                                  <span className="text-zinc-600">×{p.weight}%</span>
                                </li>
                              ))}
                              {r.convictionParts.length === 0 && (
                                <li className="text-xs text-zinc-500">No inputs available.</li>
                              )}
                            </ul>
                          </div>

                          <div>
                            <h4 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
                              Context
                            </h4>
                            <dl className="space-y-1 text-xs">
                              <div className="flex justify-between gap-4">
                                <dt className="text-zinc-500">Trend</dt>
                                <dd className="text-zinc-200">{TREND_LABELS[r.trendState]}</dd>
                              </div>
                              <div className="flex justify-between gap-4">
                                <dt className="text-zinc-500">Market cap</dt>
                                <dd className="text-zinc-200">{formatUsd(r.marketCapUsd)}</dd>
                              </div>
                              <div className="flex justify-between gap-4">
                                <dt className="text-zinc-500">24h share of 7d move</dt>
                                <dd className="text-zinc-200">{formatRatioPct(r.moveConcentration)}</dd>
                              </div>
                              <div className="flex justify-between gap-4">
                                <dt className="text-zinc-500">7d alpha vs BTC</dt>
                                <dd className={pctClass(r.relStrength7d)}>{formatPp(r.relStrength7d)}</dd>
                              </div>
                              <div className="flex justify-between gap-4">
                                <dt className="text-zinc-500">News / on-chain flags</dt>
                                <dd className="text-zinc-200">
                                  {r.newsCount} / {r.flagCount}
                                </dd>
                              </div>
                            </dl>
                            {rationaleByCoin[r.coinId] && (
                              <p className="mt-3 border-l-2 border-zinc-700 pl-2 text-xs italic text-zinc-400">
                                {rationaleByCoin[r.coinId]}
                              </p>
                            )}
                          </div>

                          <div>
                            <h4 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
                              Data caveats
                            </h4>
                            {r.caveats.length === 0 ? (
                              <p className="text-xs text-emerald-400">
                                All inputs present for this coin.
                              </p>
                            ) : (
                              <ul className="space-y-1 text-xs text-zinc-500">
                                {r.caveats.map((c) => (
                                  <li key={c} className="flex gap-1.5">
                                    <span className="text-amber-500/70">•</span>
                                    {c}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="border-t border-zinc-800 px-4 py-2.5 text-[11px] text-zinc-600">
        Showing {filtered.length} of {rows.length} tracked coins. Click a row for the score
        breakdown and data caveats.
      </footer>
    </section>
  );
}
