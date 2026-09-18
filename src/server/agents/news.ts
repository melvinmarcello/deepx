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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CoinMention {
  hits: number;
  /** Character offset of the first title mention; Infinity if body-only. */
  titleIndex: number;
}

function mentions(coin: WatchlistCoin, title: string, body: string): CoinMention {
  const re = new RegExp(`\\b(${escapeRe(coin.symbol)}|${escapeRe(coin.name)})\\b`, "gi");
  const titleMatches = [...title.matchAll(re)];
  const bodyMatches = [...body.matchAll(re)];
  return {
    // A title mention is far stronger evidence of subject than a body mention.
    hits: titleMatches.length * 3 + bodyMatches.length,
    titleIndex: titleMatches.length ? (titleMatches[0].index ?? 0) : Infinity,
  };
}

/**
 * Attributes a feed item to a single watchlist coin (`news_events.article_url`
 * is globally unique, so one article maps to one coin).
 *
 * Picks the coin with the strongest evidence of being the article's *subject*,
 * breaking ties on which coin is named earliest in the headline. Returning the
 * first watchlist match instead - as this did originally - attributed almost
 * every article to whichever coin sat at the top of the watchlist, because
 * crypto headlines mention Bitcoin as market context constantly.
 */
function matchCoin(
  title: string,
  body: string,
  watchlist: WatchlistCoin[]
): WatchlistCoin | null {
  let best: { coin: WatchlistCoin; mention: CoinMention } | null = null;

  for (const coin of watchlist) {
    const mention = mentions(coin, title, body);
    if (mention.hits === 0) continue;
    if (
      !best ||
      mention.hits > best.mention.hits ||
      (mention.hits === best.mention.hits && mention.titleIndex < best.mention.titleIndex)
    ) {
      best = { coin, mention };
    }
  }

  return best?.coin ?? null;
}

interface Classification {
  eventType: NewsEventType | string;
  sentimentScore: number;
}

/**
 * One LLM call for the whole batch (not per article). Uses the
 * "orchestrator" combo because `sub-agent` is commonly wired to a Cursor
 * AgentService that tries to use IDE tools and never returns plain JSON.
 * Falls back to keyword heuristics + neutral sentiment on any failure.
 */
async function classifyBatch(
  items: RawFeedItem[]
): Promise<Map<string, Classification>> {
  const result = new Map<string, Classification>();
  if (items.length === 0) return result;

  // Always seed with heuristics so every article has a classification even
  // if the LLM call fails or only covers a subset.
  for (const item of items) {
    result.set(item.link, {
      eventType: heuristicEventType(`${item.title} ${item.contentSnippet}`),
      sentimentScore: 0,
    });
  }

  const llmResult = await chatCompleteJSON<{
    items?: {
      url?: string;
      event_type?: string;
      sentiment_score?: number;
    }[];
  }>(
    "orchestrator",
    [
      {
        role: "system",
        content:
          "Classify crypto news headlines. Reply with ONLY JSON of the form " +
          '{"items":[{"url":"...","event_type":"listing|hack|regulation|partnership|funding|product_launch|macro|other","sentiment_score":-1to1}]}. ' +
          "Include every input url. No prose, no tools.",
      },
      {
        role: "user",
        content: JSON.stringify(
          items.map((it) => ({
            url: it.link,
            title: it.title,
            snippet: it.contentSnippet.slice(0, 240),
          }))
        ).slice(0, 8000),
      },
    ],
    { timeoutMs: 45_000 }
  );

  if (llmResult?.items && Array.isArray(llmResult.items)) {
    for (const row of llmResult.items) {
      if (!row?.url || typeof row.sentiment_score !== "number") continue;
      result.set(row.url, {
        eventType: row.event_type ?? "other",
        sentimentScore: row.sentiment_score,
      });
    }
  }

  return result;
}

/**
 * News Agent - fetches CoinDesk/Cointelegraph/The Block RSS, matches each
 * item against the watchlist (by coin name/symbol), classifies event type
 * + sentiment in one batched orchestrator call (heuristic fallback), and
 * stores new articles in `news_events`. Dedupes on `article_url`.
 */
export async function runNewsAgent(
  watchlist: WatchlistCoin[]
): Promise<{ inserted: number; scanned: number }> {
  if (watchlist.length === 0) return { inserted: 0, scanned: 0 };

  const items = await fetchAllFeeds();
  const matched: { item: RawFeedItem; coin: WatchlistCoin }[] = [];

  for (const item of items) {
    const coin = matchCoin(item.title, item.contentSnippet, watchlist);
    if (!coin) continue;
    if (await articleExists(item.link)) continue;
    matched.push({ item, coin });
  }

  const classifications = await classifyBatch(matched.map((m) => m.item));
  let inserted = 0;

  for (const { item, coin } of matched) {
    const { eventType, sentimentScore } = classifications.get(item.link) ?? {
      eventType: heuristicEventType(`${item.title} ${item.contentSnippet}`),
      sentimentScore: 0,
    };
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
