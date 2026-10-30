import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { renderCustom, markHtml, esc, clip } from "./widgetKit.ts";
import { dueFields } from "./due.ts";

const server = new McpServer({ name: "asana-tasks", version: "1.0.0" });
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

const COMPOSIO_URL = "https://backend.composio.dev/api/v3.1/tools/execute";

// Runs a Composio tool; throws with Composio's own message on any failure.
async function composio(slug: string, args: Record<string, unknown>): Promise<any> {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing Composio API key — add it in settings.");
  const userId = process.env.COMPOSIO_ENTITY_ID?.trim() || "default";

  const res = await fetch(`${COMPOSIO_URL}/${slug}`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, arguments: args }),
    signal: AbortSignal.timeout(15000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new Error(`Composio HTTP ${res.status}: ${e?.message || e || res.statusText}`);
  }
  if (!json?.successful) throw new Error(json?.error || `${slug} failed`);
  return json.data;
}

type Choice = { gid: string; name: string };
const toChoices = (list: any[] | undefined): Choice[] =>
  (list ?? []).map((x) => ({ gid: String(x.gid), name: String(x.name) }));

// Asana requires a numeric workspace GID: the settings override, else the user's first workspace.
// Cached for the life of the server process, which VoiceOS restarts on reconnect.
let workspaceCache: Choice | undefined;
async function resolveWorkspace(): Promise<Choice> {
  const envGid = process.env.ASANA_WORKSPACE_GID?.trim();
  if (envGid) return { gid: envGid, name: `Workspace ${envGid.slice(-4)}` };
  if (workspaceCache) return workspaceCache;

  const list = toChoices((await composio("ASANA_GET_MULTIPLE_WORKSPACES", {}))?.data);
  if (list.length === 0) throw new Error("No Asana workspaces found for this Composio connection.");
  return (workspaceCache = list[0]);
}

function errorResult(taskName: string, errMsg: string) {
  const errCard = renderErrorCard(taskName, errMsg);
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        error: errMsg,
        taskName,
        _voiceos_glance: { blocks: [{ type: "widget", html: errCard.html, height: errCard.height }] },
      }),
    }],
  };
}

function renderErrorCard(taskName: string, errorMessage: string) {
  const body = `
    <div class="as">
      <div class="as-head">
        ${markHtml()}
        <span class="as-chip">MY TASKS</span>
        <span class="as-tag as-err">Action Failed</span>
      </div>
      <div class="as-card as-card-err">
        <div class="as-trow">
          <div class="as-ring">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7.2" fill="rgba(240,106,106,0.18)" stroke="#f06a6a" stroke-width="1.5"/>
              <path d="M8 5v3.5M8 11h.01" stroke="#f06a6a" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="as-title">${esc(clip(taskName || "New Task", 60))}</div>
        </div>
        <div class="as-err-msg">${esc(clip(errorMessage, 180))}</div>
      </div>
      <div class="as-meta">
        <div class="as-pill">My Tasks</div>
        <div class="as-pill">Verify Composio connection</div>
      </div>
    </div>
  `;
  return renderCustom({
    accent: ACCENT,
    css: CSS,
    body,
    height: 168,
  });
}

server.registerTool(
  "list_asana_options",
  {
    title: "List Asana projects and sections",
    description: "List the user's Asana projects and their My Tasks sections (e.g. Recently assigned / Today / Next week / Later — users can rename or add their own). Always call this right before create_task and pass the results as project_choices and section_choices. Also use when the user asks which Asana projects or My Tasks sections they have.",
    inputSchema: {} as any,
  },
  async () => {
    const workspace = await resolveWorkspace();
    // shortcut: first 100 projects only; paginate via next_page.offset if users hit the cap.
    const [projectsRes, taskList] = await Promise.all([
      composio("ASANA_GET_MULTIPLE_PROJECTS", { workspace: workspace.gid, archived: false, limit: 100 }),
      composio("ASANA_GET_A_USER_TASK_LIST", { user_task_list_gid: "me", workspace: workspace.gid }),
    ]);
    const myTasksGid = taskList?.data?.gid;
    if (!myTasksGid) throw new Error("Could not find your My Tasks list in Asana.");
    const projects = toChoices(projectsRes?.data);
    const sections = toChoices((await composio("ASANA_GET_SECTIONS_IN_PROJECT", { project_gid: myTasksGid }))?.data);

    // No glance card: this is a silent lookup step before create_task's confirmation card.
    return { content: [{ type: "text" as const, text: JSON.stringify({ workspace, projects, sections }) }] };
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
      project_choices: choiceSchema.optional().describe("The projects array returned by list_asana_options, passed through unchanged"),
      section_choices: choiceSchema.optional().describe("The sections array returned by list_asana_options, passed through unchanged"),
    } as any,
  },
  async (args: {
    name: string;
    due_on?: string;
    due_time?: string;
    project?: string;
    section?: string;
    project_choices?: Choice[];
    section_choices?: Choice[];
  }) => {
    try {
      const workspaceInfo = await resolveWorkspace();
      // The confirmation card sends "" for fields the user cleared.
      const project = args.project?.trim();
      const section = args.section?.trim();

      const taskInput: Record<string, any> = {
        name: args.name,
        assignee: "me",
        workspace: workspaceInfo.gid,
        ...dueFields(args.due_on?.trim(), args.due_time?.trim()),
      };
      if (project) taskInput.projects = [project];

      const rawData = (await composio("ASANA_CREATE_A_TASK", { data: taskInput }))?.data ?? {};
      if (!rawData.gid) throw new Error("Asana returned no task ID — the task may not have been created.");

      // The task already exists at this point, so a failed move is reported, not thrown.
      let warning: string | undefined;
      if (section) {
        try {
          await composio("ASANA_ADD_TASK_TO_SECTION", { section_gid: section, task_gid: String(rawData.gid) });
        } catch (err: any) {
          warning = `Task created, but moving it to the section failed: ${err?.message}`;
        }
      }

      const sectionName = warning
        ? rawData.assignee_section?.name
        : args.section_choices?.find((s) => s.gid === section)?.name ?? rawData.assignee_section?.name;
      const task = {
        gid: String(rawData.gid),
        name: String(rawData.name || args.name),
        section: String(sectionName || "My Tasks"),
        project: rawData.projects?.[0]?.name ? String(rawData.projects[0].name) : "",
        due: rawData.due_at ? `${args.due_on} ${args.due_time}` : String(rawData.due_on || ""),
        permalink_url: rawData.permalink_url || `https://app.asana.com/0/0/${rawData.gid}`,
      };

      const cardBody = `
        <div class="as">
          <div class="as-head">
            ${markHtml()}
            <span class="as-chip">MY TASKS</span>
            <span class="as-tag ${warning ? "as-err" : "as-success"}">${warning ? "Created · section not set" : "Created in Asana"}</span>
          </div>
          <div class="as-card">
            <div class="as-trow">
              <div class="as-ring">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7.2" fill="rgba(240,106,106,0.15)" stroke="#f06a6a" stroke-width="1.6"/>
                  <path d="M4.6 8.2l2.3 2.3 4.5-4.6" stroke="#f06a6a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div class="as-title">${esc(clip(task.name, 90))}</div>
            </div>
          </div>
          <div class="as-meta">
            <div class="as-pill">${esc(clip(task.section, 18))}</div>
            ${task.project ? `<div class="as-pill">${esc(clip(task.project, 18))}</div>` : ""}
            ${task.due ? `<div class="as-pill as-due"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="9" height="8" rx="1.5"/><path d="M1.5 5h9M3.5 1.5v2M8.5 1.5v2"/></svg><span>${esc(task.due)}</span></div>` : ""}
            <a class="as-link" href="${esc(task.permalink_url)}"><span>Open</span><svg width="10" height="10" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 8.5l6-6M4 2.5h4.5V7"/></svg></a>
          </div>
        </div>
      `;

      const card = renderCustom({
        accent: ACCENT,
        css: CSS,
        body: cardBody,
        height: 135,
      });

      const payload = {
        success: true,
        task,
        ...(warning ? { warning } : {}),
        _voiceos_glance: { blocks: [{ type: "widget", html: card.html, height: card.height }] },
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    } catch (err: any) {
      console.error("create_task failed:", err);
      // A timed-out create may still have reached Asana; retrying blindly would duplicate the task.
      const msg = err?.name === "TimeoutError"
        ? "Composio did not answer in time. The task may still have been created — check Asana before retrying."
        : err?.message || "Network error while connecting to Composio.";
      return errorResult(args.name, msg);
    }
  },
);

await server.connect(new StdioServerTransport());
