import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { renderCustom, markHtml, esc, clip } from "./widgetKit.ts";

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
.as-notes{
  margin-top:5px;
  padding-left:25px;
  font-size:12.5px;
  line-height:1.45;
  color:rgba(255,255,255,0.68);
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
  word-break:break-word;
}
html[data-k-theme=light] .as-notes{
  color:rgba(0,0,0,0.68);
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
.as-avatar{
  width:14px;
  height:14px;
  border-radius:50%;
  background:var(--accent);
  color:#fff;
  font-size:8.5px;
  font-weight:700;
  display:grid;
  place-items:center;
  line-height:1;
}
.as-dot{
  width:6px;
  height:6px;
  border-radius:50%;
  background:var(--accent);
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

async function getWorkspaceInfo(apiKey: string, entityId: string): Promise<{ gid?: string; name: string }> {
  const envGid = process.env.ASANA_WORKSPACE_GID?.trim();
  if (envGid) {
    return { gid: envGid, name: `Workspace ${envGid.slice(-4)}` };
  }

  const actions = ["ASANA_GET_MULTIPLE_WORKSPACES", "ASANA_GET_ALL_WORKSPACES", "ASANA_GET_A_USER"];
  for (const act of actions) {
    try {
      const input = act === "ASANA_GET_A_USER" ? { user_gid: "me" } : {};
      const res = await fetch(`https://backend.composio.dev/api/v1/actions/${act}/execute`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ entity_id: entityId, input }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;
      const json: any = await res.json();
      const raw = json?.data?.data || json?.data || json?.response_data?.data || json?.response_data;

      if (Array.isArray(raw) && raw.length > 0) {
        const first = raw[0];
        const gid = first.gid || first.id;
        const name = first.name || "Default Workspace";
        if (gid) return { gid: String(gid), name: String(name) };
      }

      if (raw?.workspaces && Array.isArray(raw.workspaces) && raw.workspaces.length > 0) {
        const first = raw.workspaces[0];
        const gid = first.gid || first.id;
        const name = first.name || "Default Workspace";
        if (gid) return { gid: String(gid), name: String(name) };
      }
    } catch {
      // Continue to next probe
    }
  }

  return { name: "My Tasks" };
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
        <div class="as-pill"><span class="as-avatar">Me</span><span>My Tasks</span></div>
        <div class="as-pill"><span class="as-dot"></span><span>Verify Composio connection</span></div>
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
  "create_task",
  {
    title: "Create task",
    description: "Create a new task in My Tasks in Asana via Composio. Use when the user asks to create, add, or schedule a task or todo in Asana.",
    inputSchema: {
      name: z.string().describe("Task name or title"),
      notes: z.string().optional().describe("Optional task description or notes"),
      workspace: z.string().optional().describe("Optional Asana workspace GID or name"),
      due_on: z.string().optional().describe("Optional due date in YYYY-MM-DD format"),
    } as any,
  },
  async (args: { name: string; notes?: string; workspace?: string; due_on?: string }) => {
    const apiKey = process.env.COMPOSIO_API_KEY?.trim();
    if (!apiKey) {
      const errMsg = "Missing Composio API key — add it in settings.";
      const errCard = renderErrorCard(args.name, errMsg);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: errMsg,
            taskName: args.name,
            _voiceos_glance: { blocks: [{ type: "widget", html: errCard.html, height: errCard.height }] },
          }),
        }],
      };
    }

    const entityId = process.env.COMPOSIO_ENTITY_ID?.trim() || "default";

    try {
      const workspaceInfo = args.workspace
        ? { gid: args.workspace, name: `Workspace ${args.workspace.slice(-4)}` }
        : await getWorkspaceInfo(apiKey, entityId);

      const taskInput: Record<string, any> = {
        name: args.name,
        assignee: "me",
      };
      if (args.notes) taskInput.notes = args.notes;
      if (workspaceInfo.gid) taskInput.workspace = workspaceInfo.gid;
      if (args.due_on) taskInput.due_on = args.due_on;

      let res = await fetch("https://backend.composio.dev/api/v1/actions/ASANA_CREATE_A_TASK/execute", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ entity_id: entityId, input: taskInput }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 404) {
        res = await fetch("https://backend.composio.dev/api/v1/actions/ASANA_CREATE_TASK/execute", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ entity_id: entityId, input: taskInput }),
          signal: AbortSignal.timeout(8000),
        });
      }

      if (!res.ok) {
        let errDetail = `Composio HTTP ${res.status}`;
        try {
          const errJson: any = await res.json();
          errDetail = errJson?.error || errJson?.message || errDetail;
        } catch {
          // ignore parsing error
        }
        const errCard = renderErrorCard(args.name, errDetail);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: errDetail,
              taskName: args.name,
              _voiceos_glance: { blocks: [{ type: "widget", html: errCard.html, height: errCard.height }] },
            }),
          }],
        };
      }

      const json: any = await res.json();
      if (json.successful === false || json.success === false) {
        const errMsg = json.error || json.message || "Failed to create task in Asana.";
        const errCard = renderErrorCard(args.name, errMsg);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: errMsg,
              taskName: args.name,
              _voiceos_glance: { blocks: [{ type: "widget", html: errCard.html, height: errCard.height }] },
            }),
          }],
        };
      }

      const rawData = json?.data?.data || json?.data || json?.response_data?.data || json?.response_data || {};
      const task = {
        gid: String(rawData.gid || rawData.id || ""),
        name: String(rawData.name || args.name),
        notes: String(rawData.notes || args.notes || ""),
        workspace: String(rawData.workspace?.name || workspaceInfo.name || "My Tasks"),
        due_on: String(rawData.due_on || args.due_on || ""),
        permalink_url: rawData.permalink_url || (rawData.gid ? `https://app.asana.com/0/0/${rawData.gid}` : undefined),
      };

      const hasNotes = Boolean(task.notes);
      const cardBody = `
        <div class="as">
          <div class="as-head">
            ${markHtml()}
            <span class="as-chip">MY TASKS</span>
            <span class="as-tag as-success">Created in Asana</span>
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
            ${hasNotes ? `<div class="as-notes">${esc(clip(task.notes, 140))}</div>` : ""}
          </div>
          <div class="as-meta">
            <div class="as-pill"><span class="as-avatar">Me</span><span>My Tasks</span></div>
            <div class="as-pill"><span class="as-dot"></span><span>${esc(clip(task.workspace, 24))}</span></div>
            ${task.due_on ? `<div class="as-pill as-due"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="9" height="8" rx="1.5"/><path d="M1.5 5h9M3.5 1.5v2M8.5 1.5v2"/></svg><span>${esc(task.due_on)}</span></div>` : ""}
            ${task.permalink_url ? `<a class="as-link" href="${esc(task.permalink_url)}"><span>Open</span><svg width="10" height="10" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 8.5l6-6M4 2.5h4.5V7"/></svg></a>` : ""}
          </div>
        </div>
      `;

      const card = renderCustom({
        accent: ACCENT,
        css: CSS,
        body: cardBody,
        height: hasNotes ? 175 : 155,
      });

      const payload = {
        success: true,
        task,
        _voiceos_glance: { blocks: [{ type: "widget", html: card.html, height: card.height }] },
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    } catch (err: any) {
      const errMsg = err?.message || "Network error while connecting to Composio.";
      const errCard = renderErrorCard(args.name, errMsg);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: errMsg,
            taskName: args.name,
            _voiceos_glance: { blocks: [{ type: "widget", html: errCard.html, height: errCard.height }] },
          }),
        }],
      };
    }
  },
);

await server.connect(new StdioServerTransport());
