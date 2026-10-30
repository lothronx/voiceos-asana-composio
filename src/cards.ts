/**
 * The glance cards create_task attaches to its result: what the notch shows
 * after the task is created (or creation failed). Pure rendering, no I/O.
 * The confirmation card shown *before* creating lives in confirm-card/.
 */
import { renderCustom, markHtml, esc, clip, type RenderedWidget } from "../widgetKit.ts";
import type { CreateResult } from "./asana.ts";

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

/** The card when create_task failed; the message is the same text the model gets. */
export function errorCard(taskName: string, message: string): RenderedWidget {
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
          <div class="as-title">${esc(clip(taskName || "New Task", 60))}</div>
        </div>
        <div class="as-err-msg">${esc(clip(message, 180))}</div>
      </div>
      <div class="as-meta">
        <div class="as-pill">My Tasks</div>
        <div class="as-pill">Verify Composio connection</div>
      </div>
    </div>
  `;
  return renderCustom({ accent: ACCENT, css: CSS, body, height: 168 });
}
