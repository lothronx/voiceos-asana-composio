/**
 * Composio HTTP client. Knows nothing about Asana.
 *
 *   execute(slug, args)        runs one Composio tool (e.g. ASANA_CREATE_A_TASK)
 *                              for the connected user and returns its `data`
 *   request(method, path, b?)  plain REST call (e.g. listing connected accounts)
 *
 * API v3.1: tools run at their latest version when `version` is omitted
 * (v3 would pin an old one).
 */

const BASE_URL = "https://backend.composio.dev/api/v3.1";
const TIMEOUT_MS = 15_000;

/**
 * A failed Composio call.
 *  - source "composio": Composio itself refused (bad API key, no connected account, …);
 *    `status` is the HTTP status and `slug` Composio's error slug.
 *  - source "tool": the request reached the app (Asana) and the app said no;
 *    `status` is the app's HTTP status when Composio reports one.
 * A timeout is not a ComposioError: it rejects with `name === "TimeoutError"`.
 */
export class ComposioError extends Error {
  constructor(
    message: string,
    readonly source: "composio" | "tool",
    readonly status?: number,
    readonly slug?: string,
  ) {
    super(message);
    this.name = "ComposioError";
  }
}

/** Runs a Composio tool by slug and resolves to its `data`; rejects with a ComposioError. */
export type ExecuteTool = (slug: string, args: Record<string, unknown>) => Promise<any>;

/** A REST call against the Composio API; resolves to the parsed JSON body. */
export type ComposioRequest = (method: "GET" | "POST", path: string, body?: unknown) => Promise<any>;

export interface ComposioConfig {
  /** Project API key (COMPOSIO_API_KEY in .env). Checked per call, so a missing key becomes a tool error, not a crash at startup. */
  apiKey?: string;
  /** The Composio user_id the Asana account is connected under. */
  userId: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export function createComposio(config: ComposioConfig): { execute: ExecuteTool; request: ComposioRequest } {
  const request: ComposioRequest = async (method, path, body) => {
    if (!config.apiKey) throw new ComposioError("Missing Composio API key — set COMPOSIO_API_KEY in this integration's .env.", "composio");

    const res = await (config.fetch ?? fetch)(`${BASE_URL}${path}`, {
      method,
      headers: { "x-api-key": config.apiKey, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      // Errors look like { error: { message, slug, status, ... } }.
      const e = json?.error;
      throw new ComposioError(
        `Composio HTTP ${res.status}: ${e?.message || e || res.statusText}`,
        "composio",
        res.status,
        e?.slug,
      );
    }
    return json;
  };

  const execute: ExecuteTool = async (slug, args) => {
    const json = await request("POST", `/tools/execute/${slug}`, { user_id: config.userId, arguments: args });
    // The app's own failures come back as HTTP 200 with successful: false.
    if (!json?.successful) {
      throw new ComposioError(json?.error || `${slug} failed`, "tool", json?.data?.status_code);
    }
    return json.data;
  };

  return { execute, request };
}

/**
 * True when the failure means the user's app connection is missing, expired or
 * revoked — i.e. reconnecting is the fix. A bad Composio API key is not one.
 */
export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof ComposioError)) return false;
  if (err.source === "tool") return err.status === 401; // the app rejected the stored token
  return /ConnectedAccount/i.test(err.slug ?? ""); // e.g. ActionExecute_ConnectedAccountNotFound
}
