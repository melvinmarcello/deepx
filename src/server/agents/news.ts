import { fetchAllFeeds, type RawFeedItem } from "../integrations/rss";
import { chatCompleteJSON } from "../integrations/nineRouter";
import { insertNewsEvent, articleExists } from "../db/news";
import type { NewsEventType, WatchlistCoin } from "../types";

const EVENT_TYPE_KEYWORDS: Record<Exclude<NewsEventType, "other">, string[]> = {
  listing: ["lists", "listing", "listed on"],
  hack: ["hack", "exploit", "breach", "drained", "stolen"],
  regulation: ["sec ", "regulat", "lawsuit", "sues", "ban ", "compliance"],
  partnership: ["partners with", "partnership", "collaborat"],
  funding: ["raises", "funding round", "series a", "series b", "investment"],
  product_launch: ["launches", "mainnet", "upgrade", "release"],
  macro: ["fed ", "interest rate", "inflation", "etf"],
};

function heuristicEventType(text: string): NewsEventType {
  const lower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(EVENT_TYPE_KEYWORDS) as [
    Exclude<NewsEventType, "other">,
    string[],
  ][]) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }
  return "other";
}

/** Matches a feed item's title+snippet against the watchlist by coin name
 * or ticker symbol (word-boundary, case-insensitive) - returns the first
 * match in watchlist order since `news_events.article_url` is globally
 * unique (one article can only be attributed to one coin). */
function matchCoin(text: string, watchlist: WatchlistCoin[]): WatchlistCoin | null {
  for (const coin of watchlist) {
    const symbolRe = new RegExp(`\\b${coin.symbol}\\b`, "i");
    const nameRe = new RegExp(`\\b${coin.name}\\b`, "i");
    if (symbolRe.test(text) || nameRe.test(text)) return coin;
  }
  return null;
}

interface Classification {
  eventType: NewsEventType | string;
  sentimentScore: number;
}

async function classify(item: RawFeedItem): Promise<Classification> {
  const llmResult = await chatCompleteJSON<{
    event_type: string;
    sentiment_score: number;
  }>(
    "subagent",
    [
      {
        role: "system",
        content:
          'Classify a crypto news headline. Reply with ONLY JSON: {"event_type": one of ' +
          '["listing","hack","regulation","partnership","funding","product_launch","macro","other"], ' +
          '"sentiment_score": number from -1 (very negative) to 1 (very positive)}.',
      },
      {
        role: "user",
        content: `${item.title}\n\n${item.contentSnippet}`.slice(0, 1500),
      },
    ],
    { timeoutMs: 15_000 }
  );

  if (llmResult && typeof llmResult.sentiment_score === "number") {
    return {
      eventType: llmResult.event_type ?? "other",
      sentimentScore: llmResult.sentiment_score,
    };
  }

  // Fallback when the router is unreachable: keyword-based event type,
  // neutral sentiment (never fabricate a confident sentiment number
  // without an LLM/lexicon behind it).
  return {
    eventType: heuristicEventType(`${item.title} ${item.contentSnippet}`),
    sentimentScore: 0,
  };
}

/**
 * News Agent - fetches CoinDesk/Cointelegraph/The Block RSS, matches each
 * item against the watchlist (by coin name/symbol), classifies event type
 * + sentiment (9Router "subagent" combo, falling back to keyword
 * heuristics + neutral sentiment if the router is unreachable), and stores
 * new articles in `news_events`. Dedupes on `article_url` - safe to run
 * every pipeline cycle without re-ingesting or re-classifying old items.
 */
export async function runNewsAgent(
  watchlist: WatchlistCoin[]
): Promise<{ inserted: number; scanned: number }> {
  if (watchlist.length === 0) return { inserted: 0, scanned: 0 };

  const items = await fetchAllFeeds();
  let inserted = 0;

  for (const item of items) {
    const coin = matchCoin(`${item.title} ${item.contentSnippet}`, watchlist);
    if (!coin) continue;
    if (await articleExists(item.link)) continue;

    const { eventType, sentimentScore } = await classify(item);
    const row = await insertNewsEvent({
      coinId: coin.coinId,
      headline: item.title,
      source: item.source,
      articleUrl: item.link,
      eventType,
      sentimentScore,
      publishedAt: item.publishedAt,
    });
    if (row) inserted++;
  }

  return { inserted, scanned: items.length };
}
