import { expect, test } from "bun:test";
import { ComposioError, describeError } from "../server.ts";

const linkStatus = (status: string) => async () => status;
const notConnected = new ComposioError("No connected account", "composio", 404, "ActionExecute_ConnectedAccountNotFound");

test("a missing link says so and where to connect it", async () => {
  const { error, reconnect } = await describeError(notConnected, linkStatus("NONE"), "default");
  expect(error).toBe(`Asana isn't connected yet. Connect Asana for Composio user "default" in platform.composio.dev → Connected accounts.`);
  expect(reconnect).toBe(true);
});

test("an expired link and a revoked token are told apart", async () => {
  expect((await describeError(notConnected, linkStatus("EXPIRED"), "u")).error).toStartWith("The Asana connection has expired.");
  const revoked = new ComposioError("Not Authorized", "tool", 401);
  expect((await describeError(revoked, linkStatus("ACTIVE"), "u")).error).toStartWith("Asana access was revoked or disabled.");
});

test("a rejected Composio API key points at the key settings, not at reconnecting", async () => {
  const badKey = new ComposioError("Invalid API key", "composio", 401, "APIKey_InvalidAPIKey");
  expect(await describeError(badKey, linkStatus("ACTIVE"), "u")).toEqual({
    error: "The Composio API key was rejected — check the key in this integration's Setup page or .env.",
    reconnect: false,
  });
});

test("a timeout warns that the task may already exist", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  expect((await describeError(timeout, linkStatus("ACTIVE"), "u")).error).toContain("may still have been created");
});
