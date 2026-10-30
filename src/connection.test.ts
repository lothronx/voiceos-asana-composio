import { expect, test } from "bun:test";
import { createAsanaConnection } from "./connection.ts";
import type { ComposioRequest } from "./composio.ts";

/** A fake Composio REST API that answers the accounts list and records the requested paths. */
function fakeApi(items: object[]) {
  const calls: string[] = [];
  const request: ComposioRequest = async (method, path) => {
    calls.push(`${method} ${path}`);
    return { items };
  };
  return { request, calls };
}

test("asks only for this user's Asana accounts", async () => {
  const api = fakeApi([]);
  await createAsanaConnection(api.request, "default").status();
  expect(api.calls).toEqual(["GET /connected_accounts?toolkit_slugs=asana&user_ids=default"]);
});

test("ACTIVE wins over older broken accounts", async () => {
  const api = fakeApi([{ status: "EXPIRED" }, { status: "ACTIVE" }]);
  expect(await createAsanaConnection(api.request, "u").status()).toBe("ACTIVE");
});

test("without an ACTIVE account, the newest account's status explains the failure", async () => {
  const api = fakeApi([
    { status: "INITIALIZING", created_at: "2026-01-01" },
    { status: "EXPIRED", created_at: "2026-10-01" },
  ]);
  expect(await createAsanaConnection(api.request, "u").status()).toBe("EXPIRED");
});

test("no account at all is NONE", async () => {
  expect(await createAsanaConnection(fakeApi([]).request, "u").status()).toBe("NONE");
});
