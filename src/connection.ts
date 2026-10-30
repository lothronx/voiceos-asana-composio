/**
 * The status of the Asana link in Composio, used to explain failures.
 *
 * Linking itself happens once in the Composio dashboard (OAuth2, managed by
 * Composio): the account shows up as a "connected account" for a user_id and
 * toolkit "asana", and Composio refreshes its tokens. Tools only work while
 * that account is ACTIVE.
 *
 * Depends only on a ComposioRequest (see composio.ts), so tests pass a fake.
 */
import type { ComposioRequest } from "./composio.ts";

/**
 * Composio's connected-account status: INITIALIZING / INITIATED (sign-in not
 * finished), ACTIVE, or FAILED / EXPIRED / INACTIVE (needs linking again).
 * "NONE" is ours: no account at all.
 */
export type ConnectionStatus = "NONE" | "ACTIVE" | "INITIALIZING" | "INITIATED" | "FAILED" | "EXPIRED" | "INACTIVE" | string;

export function createAsanaConnection(request: ComposioRequest, userId: string) {
  /** ACTIVE if any Asana account of this user is; otherwise the newest one's status, or NONE. */
  async function status(): Promise<ConnectionStatus> {
    const query = new URLSearchParams({ toolkit_slugs: "asana", user_ids: userId });
    const list: { status: string; created_at?: string }[] = (await request("GET", `/connected_accounts?${query}`))?.items ?? [];
    if (list.some((a) => a.status === "ACTIVE")) return "ACTIVE";
    const newest = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    return newest?.status ?? "NONE";
  }

  return { status };
}
