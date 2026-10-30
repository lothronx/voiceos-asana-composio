/**
 * Composio HTTP client: runs one Composio tool (e.g. ASANA_CREATE_A_TASK) for
 * the connected user and returns its `data`. Knows nothing about Asana.
 *
 * API: POST /api/v3.1/tools/execute/{slug} — v3.1 runs the latest tool
 * version when `version` is omitted (v3 would pin an old one).
 */

const EXECUTE_URL = "https://backend.composio.dev/api/v3.1/tools/execute";
const TIMEOUT_MS = 15_000;

/**
 * Runs a Composio tool by slug and resolves to its `data`.
 * Rejects with Composio's own message on any failure; a timeout rejects with
 * an error whose `name` is "TimeoutError".
 */
export type ExecuteTool = (slug: string, args: Record<string, unknown>) => Promise<any>;

export interface ComposioConfig {
  /** Project API key. Checked per call, so a missing key becomes a tool error instead of a crash at startup. */
  apiKey?: string;
  /** The Composio user_id the Asana account is connected under. */
  userId: string;
}

export function createComposioExecutor({ apiKey, userId }: ComposioConfig): ExecuteTool {
  return async (slug, args) => {
    if (!apiKey) throw new Error("Missing Composio API key — add it in settings.");

    const res = await fetch(`${EXECUTE_URL}/${slug}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, arguments: args }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: any = await res.json().catch(() => null);

    // HTTP errors carry { error: { message } }; tool failures come back as 200 with successful: false.
    if (!res.ok) {
      const e = json?.error;
      throw new Error(`Composio HTTP ${res.status}: ${e?.message || e || res.statusText}`);
    }
    if (!json?.successful) throw new Error(json?.error || `${slug} failed`);
    return json.data;
  };
}
