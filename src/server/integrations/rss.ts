import Parser from "rss-parser";
import type { NewsSource } from "../types";

const FEEDS: Record<NewsSource, string> = {
  coindesk: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  cointelegraph: "https://cointelegraph.com/rss",
  theblock: "https://www.theblock.co/rss.xml",
};

export interface RawFeedItem {
  source: NewsSource;
  title: string;
  link: string;
  contentSnippet: string;
  publishedAt: string | null;
}

const parser = new Parser({ timeout: 15_000 });

/**
 * Fetches all configured RSS feeds (CoinDesk, Cointelegraph, The Block).
 * Each feed is isolated via Promise.allSettled - one feed being
 * down/blocked/rate-limited never blocks the others or throws.
 */
export async function fetchAllFeeds(): Promise<RawFeedItem[]> {
  const entries = Object.entries(FEEDS) as [NewsSource, string][];
  const settled = await Promise.allSettled(
    entries.map(async ([source, url]) => {
      const feed = await parser.parseURL(url);
      return (feed.items ?? []).map(
        (item): RawFeedItem => ({
          source,
          title: item.title ?? "",
          link: item.link ?? "",
          contentSnippet: item.contentSnippet ?? item.content ?? "",
          publishedAt: item.isoDate ?? item.pubDate ?? null,
        })
      );
    })
  );

  const items: RawFeedItem[] = [];
  settled.forEach((result, i) => {
    const [source] = entries[i];
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      const reason = result.reason;
      console.warn(
        `[rss] feed "${source}" failed:`,
        reason instanceof Error ? reason.message : reason
      );
    }
  });

  return items.filter((it) => it.title && it.link);
}
