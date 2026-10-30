import { expect, test } from "bun:test";
import { parseEnv } from "../server.ts";

test("reads KEY=value lines, strips quotes, skips comments and blanks", () => {
  const text = [
    "# Copy to .env",
    "",
    "COMPOSIO_API_KEY=ak_123",
    'COMPOSIO_USER_ID="default"',
    "  SPACED = value with spaces  ",
    "EMPTY=",
    "not a line",
  ].join("\n");
  expect(parseEnv(text)).toEqual({
    COMPOSIO_API_KEY: "ak_123",
    COMPOSIO_USER_ID: "default",
    SPACED: "value with spaces",
    EMPTY: "",
  });
});

test("handles Windows line endings", () => {
  expect(parseEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
});

test("a filled Setup field (env var) wins; a blank one (\"\") falls back to .env", async () => {
  const { loadEnvFile } = await import("../server.ts");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const file = `${mkdtempSync("/tmp/env-test-")}/.env`;
  writeFileSync(file, "FROM_SETUP=from-dotenv\nBLANK_SETUP=from-dotenv\n");
  process.env.FROM_SETUP = "from-setup";
  process.env.BLANK_SETUP = "";
  loadEnvFile(file);
  expect(process.env.FROM_SETUP).toBe("from-setup");
  expect(process.env.BLANK_SETUP).toBe("from-dotenv");
});
