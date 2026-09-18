import { getEnv } from "../config/env";

export type NineRouterCombo = "orchestrator" | "subagent";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: {
    message?: { role: string; content: string };
    delta?: { content?: string };
    finish_reason?: string | null;
  }[];
}

/**
 * Thin OpenAI-compatible `/chat/completions` client for the self-hosted
 * 9Router. `combo` selects which configured routing combo to hit -
 * "orchestrator" for the daily digest ranking rationale (bigger/slower
 * model), "subagent" for cheap per-item classification (news sentiment /
 * event type).
 *
 * 9Router streams OpenAI-style SSE. We must read the body incrementally and
 * stop on `[DONE]` / `finish_reason` - calling `res.text()` waits for the
 * connection to close, which this router often never does (→ abort timeout).
 */
export async function chatComplete(
  combo: NineRouterCombo,
  messages: ChatMessage[],
  opts: { temperature?: number; jsonMode?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  const env = getEnv();
  const model =
    combo === "orchestrator"
      ? env.NINEROUTER_ORCHESTRATOR_COMBO
      : env.NINEROUTER_SUBAGENT_COMBO;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);

  try {
    const res = await fetch(`${env.NINEROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
        authorization: `Bearer ${env.NINEROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        stream: true,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `9Router ${combo} (${model}) failed: ${res.status} ${res.statusText} ${body}`
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    const content =
      contentType.includes("text/event-stream") || !contentType.includes("json")
        ? await readSseChatContent(res)
        : parseJsonChatContent(await res.text());

    if (!content) {
      throw new Error(`9Router ${combo} (${model}) returned no content`);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonChatContent(raw: string): string {
  const json = JSON.parse(raw) as ChatCompletionResponse;
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Incrementally consume an SSE body, appending delta.content until the
 * stream signals completion. Aborting the reader after done lets the
 * socket close without waiting on a server that never ends the response.
 */
async function readSseChatContent(res: Response): Promise<string> {
  if (!res.body) {
    return parseSseChatContent(await res.text());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  let done = false;
  let streamError: string | null = null;

  try {
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          done = true;
          break;
        }
        try {
          const chunk = JSON.parse(payload) as ChatCompletionResponse & {
            error?: { message?: string; type?: string };
          };
          if (chunk.error?.message) {
            streamError = chunk.error.message;
            done = true;
            break;
          }
          const choice = chunk.choices?.[0];
          if (typeof choice?.delta?.content === "string") {
            out += choice.delta.content;
          } else if (typeof choice?.message?.content === "string") {
            out += choice.message.content;
          }
          // Some 9Router combos never send finish_reason / [DONE] and leave
          // the socket open. If we've already assembled a complete JSON
          // object (jsonMode callers), stop early so we don't abort on timeout.
          if (looksLikeCompleteJson(out) || choice?.finish_reason) {
            done = true;
            break;
          }
        } catch {
          // skip malformed chunk lines
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
  }

  if (streamError) {
    throw new Error(`9Router stream error: ${streamError}`);
  }
  return out;
}

/** Non-streaming fallback parser (full body already buffered). */
function parseSseChatContent(raw: string): string {
  let out = "";
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as ChatCompletionResponse & {
        error?: { message?: string };
      };
      if (chunk.error?.message) {
        throw new Error(`9Router stream error: ${chunk.error.message}`);
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      const message = chunk.choices?.[0]?.message?.content;
      if (typeof delta === "string") out += delta;
      else if (typeof message === "string") out += message;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("9Router stream error:")) {
        throw err;
      }
      // skip malformed chunk lines
    }
  }
  return out;
}

/** True when `text` is a full JSON value (object/array) that parses cleanly. */
function looksLikeCompleteJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Same as `chatComplete` but requests JSON output and parses it, returning
 * `null` on ANY failure (bad JSON, timeout, router unreachable, etc.)
 * instead of throwing. Callers must have a rule-based fallback - the
 * pipeline should never hard-fail just because the LLM router is down.
 */
export async function chatCompleteJSON<T>(
  combo: NineRouterCombo,
  messages: ChatMessage[],
  opts: { temperature?: number; timeoutMs?: number } = {}
): Promise<T | null> {
  try {
    const content = await chatComplete(combo, messages, {
      ...opts,
      jsonMode: true,
    });
    // Models sometimes wrap JSON in ```json ... ``` fences - strip those.
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.warn(
      `[9router] ${combo} JSON call failed, caller should fall back:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
