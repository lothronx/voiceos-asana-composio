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
