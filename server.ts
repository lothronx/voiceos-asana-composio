/**
 * Asana Tasks — the MCP server VoiceOS launches via run.sh (stdio; stdout is
 * the MCP wire, so log with console.error). Tools: create_task, plus the
 * agent-only helper list_asana_options that feeds the confirmation card.
 *
 * Why one file: VoiceOS "Publish" ships only server.ts, widgetKit.ts,
 * voiceos.integration.json, package.json and icon.png. Every runtime line
 * must live in those files, so the sections below stand in for modules:
 *
 *   1. .env loading        5. Connection status (explains auth failures)
 *   2. Composio client     6. Result / error cards
 *   3. Due date → Asana    7. Errors in plain words
 *   4. Asana operations    8. Tools (MCP wiring, entry point)
 *
 * Composio setup (credentials are the developer's, never VoiceOS setup fields):
 *   - Create a `.env` next to this file with
 *       COMPOSIO_API_KEY=<project key: platform.composio.dev → Settings → API Keys>
 *       COMPOSIO_USER_ID=default   # the user_id Asana is connected under
 *     .env never ships with Publish; each developer keeps their own.
 *   - TEMPORARY, for testing: the integration's Setup page also has an optional
 *     "Composio API key" field. When filled it wins over .env. Remove it from
 *     voiceos.integration.json `preferences` before release.
 *   - In platform.composio.dev → Connected accounts, connect Asana (OAuth2,
 *     Composio-managed) for that user_id. Reconnect there if it expires or is
 *     revoked; create_task errors say which one happened.
 *
 * Tool names, descriptions and input schemas must stay identical to
 * voiceos.integration.json — VoiceOS routes and confirms from the manifest.
 * create_task's confirmation card is generated into the manifest by
 * confirm-card/build.ts (local tooling, not shipped).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { renderCustom, markHtml, esc, clip, type RenderedWidget } from "./widgetKit.ts";

// ============================================================================
// 1. .env loading
// Hand-rolled on purpose: VoiceOS launches the server with its bundled Bun
// (1.3.x, no process.loadEnvFile) or with tsx/Node, and neither path can be
// relied on to read .env by itself. Supports KEY=value, KEY="value", blank lines
// and # comments. Non-empty variables already in the environment win (VoiceOS
// injects Setup fields as env vars, and a blank field arrives as "").
// ============================================================================

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
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

// ============================================================================
// 2. Composio client
//   execute(slug, args)        runs one Composio tool (e.g. ASANA_CREATE_A_TASK)
//                              for the connected user and returns its `data`
//   request(method, path, b?)  plain REST call (e.g. listing connected accounts)
//
// API v3.1: tools run at their latest version when `version` is omitted
// (v3 would pin an old one). Knows nothing about Asana.
// ============================================================================

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
  /** Project API key (COMPOSIO_API_KEY: Setup field, else .env). Checked per call, so a missing key becomes a tool error, not a crash at startup. */
  apiKey?: string;
  /** The Composio user_id the Asana account is connected under. */
  userId: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export function createComposio(config: ComposioConfig): { execute: ExecuteTool; request: ComposioRequest } {
  const request: ComposioRequest = async (method, path, body) => {
    if (!config.apiKey) throw new ComposioError("Missing Composio API key — set COMPOSIO_API_KEY in this integration's .env (or, for testing, its Setup page).", "composio");

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

// ============================================================================
// 3. Due date → Asana
// Turns create_task's due_on / due_time into Asana's due_on or due_at.
// ============================================================================

// Turns the tool's due_on / due_time args into Asana's due_on or due_at.
// due_time is wall-clock time; this server runs on the user's Mac, so the local zone is theirs.
export function dueFields(due_on?: string, due_time?: string): { due_on?: string; due_at?: string } {
  // No date means no due date; a leftover time (the user cleared only the date on the card) is ignored.
  if (!due_on) return {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_on)) throw new Error(`Due date "${due_on}" is not YYYY-MM-DD.`);
  if (!due_time) return { due_on };
  // Models often drop the leading zero ("9:00"); pad it rather than fail after the user approved.
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(due_time)) throw new Error(`Due time "${due_time}" is not HH:MM.`);
  const at = new Date(`${due_on}T${due_time.replace(/^(\d):/, "0$1:")}`);
  // Date rolls impossible values forward (Nov 31 -> Dec 1, 24:00 -> next day); reject instead.
  if (isNaN(at.getTime()) || at.getDate() !== Number(due_on.slice(8))) {
    throw new Error(`"${due_on} ${due_time}" is not a real date and time.`);
  }
  return { due_at: at.toISOString() };
}

// ============================================================================
// 4. Asana operations
// Expressed as Composio tool calls on an injected ExecuteTool (never HTTP
// directly), so tests pass a fake. Composio wraps Asana's response, so
// Asana's payload sits at `data.data`.
// ============================================================================

/** A pickable Asana object (workspace, project, section): its gid and display name. */
export type Choice = { gid: string; name: string };

/** create_task's arguments. "" means the user cleared that field on the confirmation card. */
export interface NewTask {
  name: string;
  due_on?: string;
  due_time?: string;
  project?: string;
  section?: string;
  /** Lets the result show the section's name without another API call. */
  section_choices?: Choice[];
}

/** What the model narrates and the result card shows. */
export interface CreatedTask {
  gid: string;
  name: string;
  section: string;
  project: string;
  due: string;
  permalink_url: string;
}

export interface CreateResult {
  task: CreatedTask;
  /** Set when the task exists but a follow-up step (moving it to a section) failed. */
  warning?: string;
}

const toChoices = (list: any[] | undefined): Choice[] =>
  (list ?? []).map((x) => ({ gid: String(x.gid), name: String(x.name) }));

export function createAsana(execute: ExecuteTool, opts: { workspaceGid?: string } = {}) {
  // Cached for the life of the server process, which VoiceOS restarts on reconnect.
  let workspaceCache: Choice | undefined;

  /** Asana needs a numeric workspace gid: the settings override, else the user's first workspace. */
  async function resolveWorkspace(): Promise<Choice> {
    const override = opts.workspaceGid;
    if (override) return { gid: override, name: `Workspace ${override.slice(-4)}` };
    if (workspaceCache) return workspaceCache;

    const list = toChoices((await execute("ASANA_GET_MULTIPLE_WORKSPACES", {}))?.data);
    if (list.length === 0) throw new Error("No Asana workspaces found for this Composio connection.");
    return (workspaceCache = list[0]);
  }

  /** The projects and My Tasks sections the confirmation card offers as choices. */
  async function listOptions(): Promise<{ workspace: Choice; projects: Choice[]; sections: Choice[] }> {
    const workspace = await resolveWorkspace();
    // shortcut: first 100 projects only; paginate via next_page.offset if users hit the cap.
    const [projectsRes, taskList] = await Promise.all([
      execute("ASANA_GET_MULTIPLE_PROJECTS", { workspace: workspace.gid, archived: false, limit: 100 }),
      execute("ASANA_GET_A_USER_TASK_LIST", { user_task_list_gid: "me", workspace: workspace.gid }),
    ]);
    // My Tasks is a project-like list; its sections are user-defined (and named in the user's language).
    const myTasksGid = taskList?.data?.gid;
    if (!myTasksGid) throw new Error("Could not find your My Tasks list in Asana.");
    const sectionsRes = await execute("ASANA_GET_SECTIONS_IN_PROJECT", { project_gid: myTasksGid });

    return { workspace, projects: toChoices(projectsRes?.data), sections: toChoices(sectionsRes?.data) };
  }

  /** Creates the task assigned to the user, then moves it into the chosen My Tasks section. */
  async function createTask(input: NewTask): Promise<CreateResult> {
    const workspace = await resolveWorkspace();
    const project = input.project?.trim();
    const section = input.section?.trim();

    const data: Record<string, unknown> = {
      name: input.name,
      assignee: "me",
      workspace: workspace.gid,
      ...dueFields(input.due_on?.trim(), input.due_time?.trim()),
    };
    if (project) data.projects = [project];

    const raw = (await execute("ASANA_CREATE_A_TASK", { data }))?.data ?? {};
    if (!raw.gid) throw new Error("Asana returned no task ID — the task may not have been created.");

    // Sections can't be set at creation; a separate call moves the task.
    // The task already exists here, so a failed move is a warning, not an error.
    let warning: string | undefined;
    if (section) {
      try {
        await execute("ASANA_ADD_TASK_TO_SECTION", { section_gid: section, task_gid: String(raw.gid) });
      } catch (err: any) {
        warning = `Task created, but moving it to the section failed: ${err?.message}`;
      }
    }

    // raw.assignee_section is where Asana put the task at creation, i.e. before any move.
    const sectionName = warning
      ? raw.assignee_section?.name
      : input.section_choices?.find((s) => s.gid === section)?.name ?? raw.assignee_section?.name;

    return {
      task: {
        gid: String(raw.gid),
        name: String(raw.name || input.name),
        section: String(sectionName || "My Tasks"),
        project: raw.projects?.[0]?.name ? String(raw.projects[0].name) : "",
        due: raw.due_at ? `${input.due_on} ${input.due_time}` : String(raw.due_on || ""),
        permalink_url: raw.permalink_url || `https://app.asana.com/0/0/${raw.gid}`,
      },
      warning,
    };
  }

  return { resolveWorkspace, listOptions, createTask };
}

export type Asana = ReturnType<typeof createAsana>;

// ============================================================================
// 5. Connection status
// Linking happens once in the Composio dashboard (OAuth2, Composio-managed):
// the account shows up as a "connected account" for a user_id and toolkit
// "asana", and Composio refreshes its tokens. Tools only work while that
// account is ACTIVE; this status explains failures when it is not.
// ============================================================================

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

export type AsanaConnection = ReturnType<typeof createAsanaConnection>;

// ============================================================================
// 6. Result / error cards
// The glance cards create_task attaches to its result. Pure rendering, no I/O.
// The confirmation card shown *before* creating is built into the manifest.
// ============================================================================

const ACCENT = "#f06a6a"; // Asana coral brand accent

const CSS = `
.as{
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  padding:10px 14px 13px;
  color:var(--ink-1);
}
.as-head{
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:9px;
}
.as-chip{
  font-size:10px;
  font-weight:600;
  letter-spacing:0.04em;
  text-transform:uppercase;
  color:var(--ink-4);
}
.as-tag{
  font-size:11px;
  font-weight:500;
  color:var(--ink-3);
  margin-left:auto;
}
.as-tag.as-success{
  color:var(--good);
}
.as-tag.as-err{
  color:var(--bad);
}
.as-card{
  background:rgba(255,255,255,0.04);
  border:1px solid rgba(255,255,255,0.08);
  border-radius:8px;
  padding:10px 12px;
  margin-bottom:9px;
  transition:border-color .15s ease;
}
html[data-k-theme=light] .as-card{
  background:rgba(0,0,0,0.03);
  border-color:rgba(0,0,0,0.08);
}
.as-card-err{
  background:rgba(240,106,106,0.08);
  border-color:rgba(240,106,106,0.25);
}
html[data-k-theme=light] .as-card-err{
  background:rgba(240,106,106,0.06);
  border-color:rgba(240,106,106,0.2);
}
.as-trow{
  display:flex;
  align-items:flex-start;
  gap:9px;
}
.as-ring{
  flex:none;
  width:16px;
  height:16px;
  margin-top:2px;
  display:grid;
  place-items:center;
}
.as-title{
  flex:1;
  min-width:0;
  font-size:15px;
  font-weight:600;
  line-height:1.35;
  color:var(--ink-1);
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
  word-break:break-word;
}
.as-err-msg{
  margin-top:6px;
  padding-left:25px;
  font-size:12px;
  line-height:1.4;
  color:var(--ink-2);
}
.as-meta{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.as-pill{
  display:inline-flex;
  align-items:center;
  gap:5px;
  height:22px;
  padding:0 8px;
  border-radius:999px;
  background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.06);
  font-size:11px;
  font-weight:500;
  color:var(--ink-2);
  white-space:nowrap;
}
html[data-k-theme=light] .as-pill{
  background:rgba(0,0,0,0.04);
  border-color:rgba(0,0,0,0.06);
}
.as-pill.as-due{
  color:var(--ink-3);
  font-variant-numeric:tabular-nums;
}
.as-link{
  display:inline-flex;
  align-items:center;
  gap:4px;
  height:22px;
  padding:0 8px;
  border-radius:999px;
  background:rgba(240,106,106,0.12);
  border:1px solid rgba(240,106,106,0.25);
  font-size:11px;
  font-weight:600;
  color:var(--accent);
  text-decoration:none;
  margin-left:auto;
}
.as-link:hover{
  background:rgba(240,106,106,0.22);
}
@media(prefers-reduced-motion:no-preference){
  .as-card{animation:asIn .24s cubic-bezier(.22,.61,.36,1) both}
  .as-meta{animation:asIn .24s cubic-bezier(.22,.61,.36,1) .04s both}
}
@keyframes asIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
`;

// Inline icons (cards can't load images over the network).
const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7.2" fill="rgba(240,106,106,0.15)" stroke="#f06a6a" stroke-width="1.6"/><path d="M4.6 8.2l2.3 2.3 4.5-4.6" stroke="#f06a6a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ALERT_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7.2" fill="rgba(240,106,106,0.18)" stroke="#f06a6a" stroke-width="1.5"/><path d="M8 5v3.5M8 11h.01" stroke="#f06a6a" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const CALENDAR_ICON = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="9" height="8" rx="1.5"/><path d="M1.5 5h9M3.5 1.5v2M8.5 1.5v2"/></svg>`;
const OPEN_ICON = `<svg width="10" height="10" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 8.5l6-6M4 2.5h4.5V7"/></svg>`;

/** Wraps a rendered card in the `_voiceos_glance` shape a tool result carries. */
export function glance(card: RenderedWidget) {
  return { blocks: [{ type: "widget", html: card.html, height: card.height }] };
}

/** The card after a successful create; a warning (e.g. section move failed) turns the status tag red. */
export function successCard({ task, warning }: CreateResult): RenderedWidget {
  const body = `
    <div class="as">
      <div class="as-head">
        ${markHtml()}
        <span class="as-chip">MY TASKS</span>
        <span class="as-tag ${warning ? "as-err" : "as-success"}">${warning ? "Created · section not set" : "Created in Asana"}</span>
      </div>
      <div class="as-card">
        <div class="as-trow">
          <div class="as-ring">${CHECK_ICON}</div>
          <div class="as-title">${esc(clip(task.name, 90))}</div>
        </div>
      </div>
      <div class="as-meta">
        <div class="as-pill">${esc(clip(task.section, 18))}</div>
        ${task.project ? `<div class="as-pill">${esc(clip(task.project, 18))}</div>` : ""}
        ${task.due ? `<div class="as-pill as-due">${CALENDAR_ICON}<span>${esc(task.due)}</span></div>` : ""}
        <a class="as-link" href="${esc(task.permalink_url)}"><span>Open</span>${OPEN_ICON}</a>
      </div>
    </div>
  `;
  return renderCustom({ accent: ACCENT, css: CSS, body, height: 135 });
}

/** The card when a tool failed; the message is the same text the model gets. */
export function errorCard(title: string, message: string): RenderedWidget {
  const body = `
    <div class="as">
      <div class="as-head">
        ${markHtml()}
        <span class="as-chip">MY TASKS</span>
        <span class="as-tag as-err">Action Failed</span>
      </div>
      <div class="as-card as-card-err">
        <div class="as-trow">
          <div class="as-ring">${ALERT_ICON}</div>
          <div class="as-title">${esc(clip(title, 60))}</div>
        </div>
        <div class="as-err-msg">${esc(clip(message, 180))}</div>
      </div>
    </div>
  `;
  return renderCustom({ accent: ACCENT, css: CSS, body, height: 140 });
}

// ============================================================================
// 7. Errors in plain words
// ============================================================================

// Where whoever owns the Composio project links the Asana account (once, via OAuth2).
export const DASHBOARD = "platform.composio.dev → Connected accounts";

/**
 * Turns a failure into words the user can act on. `reconnect` is true when
 * linking Asana again in the Composio dashboard is the fix.
 */
export async function describeError(
  err: any,
  connection: AsanaConnection,
  userId: string,
): Promise<{ error: string; reconnect: boolean }> {
  // A timed-out create may still have reached Asana; retrying blindly would duplicate the task.
  if (err?.name === "TimeoutError") {
    return { error: "Composio did not answer in time. The task may still have been created — check Asana before retrying.", reconnect: false };
  }
  if (isConnectionError(err)) {
    // Ask Composio why, so the message can say "expired" vs "never connected" vs "revoked".
    const status = await connection.status().catch(() => "UNKNOWN");
    const why = status === "NONE" || status === "INITIALIZING" || status === "INITIATED" ? "Asana isn't connected yet."
      : status === "EXPIRED" ? "The Asana connection has expired."
      : "Asana access was revoked or disabled.";
    return { error: `${why} Connect Asana for Composio user "${userId}" in ${DASHBOARD}.`, reconnect: true };
  }
  if (err instanceof ComposioError && err.source === "composio" && err.status === 401) {
    return { error: "The Composio API key was rejected — check the key in this integration's Setup page or .env.", reconnect: false };
  }
  return { error: err?.message || "Network error while connecting to Composio.", reconnect: false };
}

// ============================================================================
// 8. Tools (MCP wiring, entry point)
// Only runs when this file is the program (VoiceOS / run.sh), not when tests
// import it. import.meta.main is missing under tsx, so compare paths instead.
// ============================================================================

async function main(): Promise<void> {
  loadEnvFile(fileURLToPath(new URL(".env", import.meta.url)));

  const userId = process.env.COMPOSIO_USER_ID?.trim() || "default";
  const composio = createComposio({ apiKey: process.env.COMPOSIO_API_KEY?.trim(), userId });
  const asana = createAsana(composio.execute, { workspaceGid: process.env.ASANA_WORKSPACE_GID?.trim() || undefined });
  const connection = createAsanaConnection(composio.request, userId);

  const server = new McpServer({ name: "asana-tasks", version: "1.0.0" });

  /** A tool result: JSON the model reads (plus `_voiceos_glance` when the notch should show a card). */
  const textResult = (payload: unknown, isError = false) => ({
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  });

  server.registerTool(
    "list_asana_options",
    {
      title: "List Asana projects and sections",
      description: "List the user's Asana projects and their My Tasks sections (e.g. Recently assigned / Today / Next week / Later — users can rename or add their own). Always call this right before create_task and pass the results as project_choices and section_choices. Also use when the user asks which Asana projects or My Tasks sections they have.",
      inputSchema: {} as any,
    },
    // No glance card: this is a silent lookup step before create_task's confirmation card.
    async () => {
      try {
        return textResult(await asana.listOptions());
      } catch (err) {
        console.error("list_asana_options failed:", err);
        return textResult(await describeError(err, connection, userId), true);
      }
    },
  );

  const choiceSchema = z.array(z.object({ gid: z.string(), name: z.string() }));

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description: "Create a new task assigned to the user in Asana My Tasks via Composio. Use when the user asks to create, add, or schedule a task or todo in Asana. First call list_asana_options and pass its projects and sections as project_choices and section_choices so the user can pick them on the confirmation card. Set project / section only when the user named one, using its gid.",
      inputSchema: {
        name: z.string().describe("Task name or title"),
        due_on: z.string().optional().describe("Optional due date, YYYY-MM-DD"),
        due_time: z.string().optional().describe("Optional due time in the user's local time, 24h HH:MM; requires due_on"),
        project: z.string().optional().describe("Optional project gid from list_asana_options"),
        section: z.string().optional().describe("Optional My Tasks section gid from list_asana_options"),
        // Only the confirmation card reads these (to fill its dropdowns); the handler ignores project_choices.
        project_choices: choiceSchema.optional().describe("The projects array returned by list_asana_options, passed through unchanged"),
        section_choices: choiceSchema.optional().describe("The sections array returned by list_asana_options, passed through unchanged"),
      } as any,
    },
    async (args: NewTask) => {
      try {
        const result = await asana.createTask(args);
        return textResult({ success: true, ...result, _voiceos_glance: glance(successCard(result)) });
      } catch (err: any) {
        console.error("create_task failed:", err);
        const { error, reconnect } = await describeError(err, connection, userId);
        const card = errorCard(args.name || "New Task", error);
        return textResult({ error, reconnect, taskName: args.name, _voiceos_glance: glance(card) }, true);
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

const isEntryPoint = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) await main();
