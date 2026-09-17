/**
 * Default tracked-coin watchlist, seeded on first migration/boot.
 *
 * `coinId` is our own internal identifier (primary key across all our
 * tables - news_events, onchain_flags, risk_scores, daily_digest, etc.).
 * It has no meaning to any external API. `symbol` is the ticker used to
 * query CoinMarketCap (`/v1/cryptocurrency/quotes/latest?symbol=...`).
 *
 * `chains` holds the token's contract address per chain for the On-Chain
 * Agent (Etherscan v2, chainid=1 ETH / chainid=56 BSC). Native L1 coins
 * (BTC, SOL, ...) have no ERC-20/BEP-20 contract and are omitted there -
 * the On-Chain Agent simply skips chains with no address configured.
 */
export interface TrackedCoin {
  coinId: string;
  symbol: string; // ticker, queried against CoinMarketCap
  name: string;
  /** Why it's on the list - shown nowhere user-facing yet, just for maintainers */
  note?: string;
  chains?: {
    ethereum?: string; // ERC-20 contract address (chainid=1)
    bsc?: string; // BEP-20 contract address (chainid=56)
  };
}

// --- Top-15 majors by market cap / liquidity ---
const MAJORS: TrackedCoin[] = [
  { coinId: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { coinId: "ethereum", symbol: "ETH", name: "Ethereum" },
  { coinId: "solana", symbol: "SOL", name: "Solana" },
  { coinId: "bnb", symbol: "BNB", name: "BNB" },
  { coinId: "xrp", symbol: "XRP", name: "XRP" },
  { coinId: "cardano", symbol: "ADA", name: "Cardano" },
  { coinId: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { coinId: "avalanche", symbol: "AVAX", name: "Avalanche" },
  {
    coinId: "chainlink",
    symbol: "LINK",
    name: "Chainlink",
    chains: { ethereum: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
  },
  { coinId: "polkadot", symbol: "DOT", name: "Polkadot" },
  { coinId: "litecoin", symbol: "LTC", name: "Litecoin" },
  {
    coinId: "uniswap",
    symbol: "UNI",
    name: "Uniswap",
    chains: { ethereum: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
  },
  { coinId: "cosmos", symbol: "ATOM", name: "Cosmos" },
  {
    coinId: "arbitrum",
    symbol: "ARB",
    name: "Arbitrum",
    chains: { ethereum: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1" },
  },
  {
    coinId: "polygon",
    symbol: "POL",
    name: "Polygon",
    note: "POL is the rebranded MATIC token",
    chains: { ethereum: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0" },
  },
];

// --- Discretionary picks: strong news flow / fundamentals / tokenomics / investor backing ---
// Contract addresses intentionally omitted here until verified in the
// On-Chain Agent build step - see AGENT_NOTES.md.
const HIGH_CONVICTION: TrackedCoin[] = [
  {
    coinId: "render",
    symbol: "RENDER",
    name: "Render",
    note: "AI/GPU compute narrative, real usage-based token burn",
  },
  {
    coinId: "injective",
    symbol: "INJ",
    name: "Injective",
    note: "DeFi L1 with weekly deflationary token burn auctions",
  },
  {
    coinId: "celestia",
    symbol: "TIA",
    name: "Celestia",
    note: "Modular blockchain, strong dev activity & ecosystem funding",
  },
  {
    coinId: "bittensor",
    symbol: "TAO",
    name: "Bittensor",
    note: "AI/decentralized-compute narrative, strong investor backing",
  },
  {
    coinId: "pyth",
    symbol: "PYTH",
    name: "Pyth Network",
    note: "Oracle infra, institutional data partnerships",
  },
  {
    coinId: "jupiter",
    symbol: "JUP",
    name: "Jupiter",
    note: "Solana DEX aggregator with real protocol revenue",
  },
  {
    coinId: "ondo",
    symbol: "ONDO",
    name: "Ondo Finance",
    note: "RWA tokenization, institutional/TradFi interest",
  },
  {
    coinId: "sei",
    symbol: "SEI",
    name: "Sei",
    note: "High-throughput L1 tuned for trading/orderbook infra",
  },
];

export const DEFAULT_WATCHLIST: TrackedCoin[] = [...MAJORS, ...HIGH_CONVICTION];
