import { getEnv } from "../config/env";

export type NineRouterCombo = "orchestrator" | "subagent";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { role: string; content: string } }[];
}

/**
 * Thin OpenAI-compatible `/chat/completions` client for the self-hosted
 * 9Router. `combo` selects which configured routing combo to hit -
 * "orchestrator" for the daily digest ranking rationale (bigger/slower
 * model), "subagent" for cheap per-item classification (news sentiment /
 * event type).
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
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  try {
    const res = await fetch(`${env.NINEROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.NINEROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
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

    const json = (await res.json()) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(`9Router ${combo} (${model}) returned no content`);
    return content;
  } finally {
    clearTimeout(timeout);
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
    const content = await chatComplete(combo, messages, { ...opts, jsonMode: true });
    return JSON.parse(content) as T;
  } catch (err) {
    console.warn(
      `[9router] ${combo} JSON call failed, caller should fall back:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
