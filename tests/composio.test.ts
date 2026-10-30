import { expect, test } from "bun:test";
import { ComposioError, createComposio, isConnectionError } from "../server.ts";

/** A fetch that always answers with this status and JSON body, and records the last request. */
function fakeFetch(status: number, body: unknown) {
  const seen: { url?: string; init?: RequestInit } = {};
  const fn = (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const client = (status: number, body: unknown) => {
  const f = fakeFetch(status, body);
  return { ...createComposio({ apiKey: "ak_test", userId: "u1", fetch: f.fn }), seen: f.seen };
};

const failure = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a rejection"); }, (e) => e);

test("execute posts the user and arguments to the tool's v3.1 endpoint and returns its data", async () => {
  const c = client(200, { successful: true, data: { data: [1] }, error: null });
  expect(await c.execute("ASANA_GET_MULTIPLE_WORKSPACES", { limit: 1 })).toEqual({ data: [1] });
  expect(c.seen.url).toBe("https://backend.composio.dev/api/v3.1/tools/execute/ASANA_GET_MULTIPLE_WORKSPACES");
  expect(JSON.parse(String(c.seen.init?.body))).toEqual({ user_id: "u1", arguments: { limit: 1 } });
});

test("no connected account (real Composio response) is a connection error", async () => {
  const c = client(404, {
    error: { message: "No connected account found for user ID u1 for toolkit asana", code: 1810, slug: "ActionExecute_ConnectedAccountNotFound", status: 404 },
  });
  const err = await failure(c.execute("ASANA_CREATE_A_TASK", {}));
  expect(err).toBeInstanceOf(ComposioError);
  expect(isConnectionError(err)).toBe(true);
});

test("Asana rejecting the stored token (tool-level 401) is a connection error", async () => {
  const c = client(200, { successful: false, data: { status_code: 401 }, error: "Not Authorized" });
  expect(isConnectionError(await failure(c.execute("ASANA_CREATE_A_TASK", {})))).toBe(true);
});

test("a bad Composio API key or an ordinary Asana error is not a connection error", async () => {
  const badKey = client(401, { error: { message: "Invalid API key", slug: "APIKey_InvalidAPIKey", status: 401 } });
  expect(isConnectionError(await failure(badKey.execute("X", {})))).toBe(false);

  const badInput = client(200, { successful: false, data: { status_code: 400 }, error: "projects: Not a Long" });
  expect(isConnectionError(await failure(badInput.execute("X", {})))).toBe(false);
});

test("a missing API key fails before any network call", async () => {
  const f = fakeFetch(200, {});
  const c = createComposio({ userId: "u1", fetch: f.fn });
  expect((await failure(c.request("GET", "/auth_configs"))).message).toContain("Missing Composio API key");
  expect(f.seen.url).toBeUndefined();
});

test("proxy looks up the user's ACTIVE account and sends user_id + connected_account_id with the raw body", async () => {
  const sent: { url: string; body: any }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const body = url.includes("/connected_accounts") ? { items: [{ id: "ca_1" }] } : { status: 200, data: { data: { gid: "42" } } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const { proxy } = createComposio({ apiKey: "ak", userId: "u1", fetch: fetchFn });

  expect(await proxy("asana", "PUT", "https://app.asana.com/api/1.0/tasks/42", { data: { assignee: null } })).toEqual({ data: { gid: "42" } });
  expect(sent[0].url).toBe("https://backend.composio.dev/api/v3.1/connected_accounts?toolkit_slugs=asana&user_ids=u1&statuses=ACTIVE");
  expect(sent[1].body).toEqual({
    endpoint: "https://app.asana.com/api/1.0/tasks/42", method: "PUT", body: { data: { assignee: null } },
    user_id: "u1", connected_account_id: "ca_1",
  });
});

test("proxy without an active account is a connection error; an app error status throws", async () => {
  const none = createComposio({ apiKey: "ak", userId: "u1", fetch: (async () => new Response(JSON.stringify({ items: [] }))) as any });
  expect(isConnectionError(await failure(none.proxy("asana", "PUT", "x")))).toBe(true);

  const forbidden = createComposio({
    apiKey: "ak", userId: "u1",
    fetch: (async (url: string) => new Response(JSON.stringify(url.includes("connected_accounts") ? { items: [{ id: "ca" }] } : { status: 403, data: { errors: [{ message: "Forbidden" }] } }))) as any,
  });
  const err = await failure(forbidden.proxy("asana", "PUT", "x"));
  expect(err.message).toBe("Forbidden");
});
