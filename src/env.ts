/**
 * Minimal .env loader. Hand-rolled on purpose: VoiceOS launches the server with
 * its bundled Bun (1.3.x, no process.loadEnvFile) or with tsx/Node, and neither
 * path can be relied on to read .env by itself.
 *
 * Supports `KEY=value`, `KEY="value"`, blank lines and `#` comments. Variables
 * already set in the environment win, so a real env var overrides .env.
 */
import { readFileSync } from "node:fs";

export function parseEnv(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue; // blank line, comment or junk
    vars[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return vars;
}

/** Loads `path` into process.env if it exists; a missing file is fine (calls then report the missing key). */
export function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
