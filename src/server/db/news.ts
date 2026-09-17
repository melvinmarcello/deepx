import { getPool } from "./client";
import type { NewsEvent, NewsEventType, NewsSource } from "../types";

interface NewsEventRow {
  id: number;
  coin_id: string;
  headline: string;
  source: string | null;
  article_url: string | null;
  event_type: string | null;
  sentiment_score: string | null;
  published_at: string | null;
  ingested_at: string;
}

function toNewsEvent(row: NewsEventRow): NewsEvent {
  return {
    id: row.id,
    coinId: row.coin_id,
    headline: row.headline,
    source: (row.source ?? "other") as NewsSource | string,
    articleUrl: row.article_url,
    eventType: row.event_type as NewsEventType | string | null,
    sentimentScore: row.sentiment_score != null ? Number(row.sentiment_score) : null,
    publishedAt: row.published_at,
    ingestedAt: row.ingested_at,
  };
}

export interface InsertNewsEventInput {
  coinId: string;
  headline: string;
  source: NewsSource | string;
  articleUrl: string;
  eventType: NewsEventType | string | null;
  sentimentScore: number | null;
  publishedAt: string | null;
}

/** Cheap existence check to skip re-classifying (and re-spending an LLM
 * call on) articles we've already ingested on a previous pipeline run. */
export async function articleExists(articleUrl: string): Promise<boolean> {
  const res = await getPool().query(
    "SELECT 1 FROM news_events WHERE article_url = $1",
    [articleUrl]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Insert one news event; no-ops (returns null) if article_url was already ingested. */
export async function insertNewsEvent(
  input: InsertNewsEventInput
): Promise<NewsEvent | null> {
  const res = await getPool().query<NewsEventRow>(
    `INSERT INTO news_events (coin_id, headline, source, article_url, event_type, sentiment_score, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (article_url) DO NOTHING
     RETURNING *`,
    [
      input.coinId,
      input.headline,
      input.source,
      input.articleUrl,
      input.eventType,
      input.sentimentScore,
      input.publishedAt,
    ]
  );
  return res.rows[0] ? toNewsEvent(res.rows[0]) : null;
}

export async function getRecentNewsForCoin(
  coinId: string,
  sinceHours = 24
): Promise<NewsEvent[]> {
  const res = await getPool().query<NewsEventRow>(
    `SELECT * FROM news_events
     WHERE coin_id = $1 AND published_at >= now() - ($2 || ' hours')::interval
     ORDER BY published_at DESC`,
    [coinId, sinceHours]
  );
  return res.rows.map(toNewsEvent);
}

export async function getRecentNews(limit = 50): Promise<NewsEvent[]> {
  const res = await getPool().query<NewsEventRow>(
    `SELECT * FROM news_events ORDER BY published_at DESC NULLS LAST LIMIT $1`,
    [limit]
  );
  return res.rows.map(toNewsEvent);
}
