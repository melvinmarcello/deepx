# DeepX

An automated crypto market-monitoring pipeline. A background worker periodically
pulls market data, news, and on-chain activity for a watchlist of coins,
scores each coin's risk, and produces a ranked daily digest with an
LLM-generated rationale. A Next.js app exposes the results over a small API
(dashboard UI is still TODO).

## Architecture

```
                     ┌─────────────────┐
   cron (node-cron) →│  Pipeline Runner │  (src/server/pipeline/runPipeline.ts)
                     └────────┬─────────┘
                              │ each stage isolated - one API outage
                              │ degrades that stage only, never crashes
                              │ the whole run (status: success/partial/failed)
        ┌───────────┬─────────┼───────────┬─────────────┐
        ▼           ▼         ▼           ▼             ▼
   Market Data   News      On-Chain   Risk Scoring   Daily Digest
   (CoinMarketCap) (RSS)   (Etherscan)  (internal)   (9Router LLM)
        │           │         │           │             │
        └───────────┴─────────┴───────────┴─────────────┘
                              │
                         PostgreSQL (+ Redis price cache)
                              │
                     Next.js API routes (src/app/api/*)
```

### Agents (`src/server/agents/`)

| Agent | Source | Notes |
|---|---|---|
| `marketData.ts` | CoinMarketCap `/quotes/latest` | Redis-cached (~10 min TTL); cache failures degrade to "always fetch". |
| `news.ts` | CoinDesk / Cointelegraph / The Block RSS | Matches items to the watchlist by name/symbol; classifies event type + sentiment via 9Router, with keyword-heuristic fallback. Dedupes on article URL. |
| `onchain.ts` | Etherscan v2 (`chainid=1` ETH, `chainid=56` BSC) | Flags ERC-20/BEP-20 transfers above `ONCHAIN_FLAG_USD_THRESHOLD`; direction is best-effort classified against a small known-exchange-wallet list. |
| `riskScore.ts` | Internal (no external API) | Volatility / liquidity / concentration sub-scores (0-100, higher = riskier) + weighted composite, computed from data the other agents already collected. |
| `digest.ts` | Internal ranking + 9Router | Ranks the top 10 coins by a deterministic rule-based signal score (momentum + news sentiment − risk); asks the 9Router "orchestrator" combo for a one-line rationale per coin, falling back to an auto-generated one if the LLM is unreachable. |

Every external call (CoinMarketCap, Etherscan, RSS feeds, 9Router) is wrapped
so failures never throw past the agent boundary - a bad network day degrades
individual pipeline stages instead of crashing the whole run.

### Data (PostgreSQL + TimescaleDB)

Migrations live in `src/server/db/migrations/` and are run in order by
`scripts/migrate.ts`:

| Table | Purpose |
|---|---|
| `watchlist` | Tracked coins (internal `coin_id`, ticker, optional ETH/BSC contract addresses). |
| `news_events` | Ingested news articles matched to a coin. |
| `onchain_flags` | Large token transfers flagged by the On-Chain Agent. |
| `risk_scores` | Historical risk sub-scores + composite, one row per pipeline run per coin. |
| `daily_price_agg` | Daily OHLC/volume downsample per coin (optionally a TimescaleDB hypertable). |
| `daily_digest` | Ranked daily digest entries (one per coin per day). |
| `pipeline_runs` | Run history: status (`success` / `partial` / `failed`) + per-step errors. |

## Prerequisites

- Node.js 20+
- Docker (for the bundled Postgres/TimescaleDB container) - or a native
  Postgres 15+ instance with the `timescaledb` extension
- Redis running locally
- A self-hosted [9Router](https://github.com/9router) instance (or any
  OpenAI-compatible chat-completions endpoint) for LLM classification/rationale
- API keys: [CoinMarketCap](https://coinmarketcap.com/api/), [Etherscan](https://etherscan.io/apis)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Fill in `DATABASE_URL`, `REDIS_URL`, `NINEROUTER_*`, `COINMARKETCAP_API_KEY`,
   and `ETHERSCAN_API_KEY`. See `.env.example` for the full list and defaults.

3. **Start Postgres**

   ```bash
   docker compose up -d
   ```

   This starts TimescaleDB on host port `5433` (see `docker-compose.yml` -
   `5432` is left free for a native Postgres install, if you have one).

4. **Run migrations and seed the watchlist**

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

   `db:seed` inserts the default watchlist (top majors + a discretionary
   high-conviction list) defined in `src/server/config/watchlist.ts`. It's
   idempotent - safe to re-run.

5. **(Optional) Enable the TimescaleDB hypertable**

   ```bash
   npm run db:enable-timescale
   ```

   Converts `daily_price_agg` into a hypertable. Requires the `timescaledb`
   extension binary to be installed on the Postgres server first - see the
   header comment in `scripts/enable-timescaledb.ts` for install steps.

## Running it

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server (dashboard + API routes) at `http://localhost:3000`. |
| `npm run worker` | Long-running worker: schedules the pipeline on `PIPELINE_CRON` (default: every 2 hours). Set `PIPELINE_RUN_ON_BOOT=true` to also run once immediately. |
| `npm run pipeline:run` | Runs one pipeline cycle immediately and exits - useful for testing without waiting on cron. |
| `npm run test:market-data` | Manual smoke test of just the Market Data Agent + Redis cache. |
| `npm run db:migrate` | Applies any pending SQL migrations. |
| `npm run db:seed` | Seeds the default watchlist (idempotent). |
| `npm run db:enable-timescale` | One-time hypertable conversion for `daily_price_agg`. |
| `npm run lint` | ESLint. |
| `npm run build` / `npm run start` | Production build/serve. |

## API routes

All routes live under `src/app/api/` and return JSON.

| Route | Methods | Description |
|---|---|---|
| `/api/watchlist` | `GET`, `POST`, `DELETE` | List / add / soft-remove tracked coins. |
| `/api/market-snapshots` | `GET` | Live market data for the watchlist (Redis-cached). |
| `/api/news` | `GET` | Recent news events (optional `coinId`, `hours`, `limit` query params). |
| `/api/onchain-flags` | `GET` | Recent flagged on-chain transfers (optional `coinId`, `hours`, `limit`). |
| `/api/risk-scores` | `GET` | Latest risk score per coin. |
| `/api/digest` | `GET` | Latest daily digest, or a specific day via `?date=YYYY-MM-DD`. |
| `/api/pipeline/run` | `GET`, `POST` | `GET` recent pipeline run history; `POST` manually triggers a run. |

## Environment variables

See `.env.example` for the authoritative list. Summary:

- `DATABASE_URL`, `REDIS_URL` - Postgres and Redis connection strings.
- `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, `NINEROUTER_ORCHESTRATOR_COMBO`,
  `NINEROUTER_SUBAGENT_COMBO` - self-hosted LLM router config.
- `COINMARKETCAP_API_KEY`, `COINMARKETCAP_BASE_URL` - market data source.
- `ETHERSCAN_API_KEY`, `ETHERSCAN_BASE_URL` - on-chain data source (v2 unified
  API - one key covers both `chainid=1` ETH and `chainid=56` BSC).
- `ONCHAIN_FLAG_USD_THRESHOLD` - minimum USD value for a transfer to be flagged.
- `PIPELINE_CRON`, `PIPELINE_RUN_ON_BOOT` - worker scheduling.

## Tech stack

Next.js 16 (App Router) · TypeScript · PostgreSQL/TimescaleDB (`pg`) · Redis
(`ioredis`) · `node-cron` · `rss-parser` + `@mozilla/readability`/`jsdom` ·
Zod · Tailwind CSS.
