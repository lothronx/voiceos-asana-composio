/**
 * Builds the confirmation cards of create_task and update_task and writes
 * them into voiceos.integration.json (tools[name].confirmation.root):
 *
 *   card.css   how they look
 *   card.js    how they behave (date/time pickers, list fields) — shared
 *   build.ts   the markup (this file); widgetKit wraps all three into one page
 *
 * Run `bun confirm-card/build.ts` after editing any of them. VoiceOS caches the
 * manifest at install time, so the integration must be refreshed afterwards.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderCustom, markHtml } from "../widgetKit.ts";

const dir = import.meta.dir;
const read = (file: string) => readFileSync(`${dir}/${file}`, "utf8");
const manifestPath = `${dir}/../voiceos.integration.json`;

// Inline icons (the card can't load images over the network).
const chevron = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.75L5 6.25l2.5-2.5"/></svg>`;
const calIcon = `<svg class="as-ic" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.75" y="2.75" width="10.5" height="9.5" rx="2"/><path d="M1.75 5.75h10.5M4.75 1.25v2.5M9.25 1.25v2.5"/></svg>`;

// data-voiceos-key binds an element to a tool argument (see card.js).
// Popovers sit right after their row; card.js positions them absolutely.

const header = (chip: string) => `<div class="as-head">${markHtml()}<span class="as-chip">${chip}</span></div>
<input class="as-title" data-voiceos-key="name" placeholder="Task name" spellcheck="false" autocomplete="off" />`;

/** The description, a quiet two-line field under the title (bound to `notes`). */
const notesField = `<textarea class="as-notes" data-voiceos-key="notes" rows="2" placeholder="Add a description" spellcheck="false"></textarea>`;

/** Due date + time on one row (70/30), with the calendar and time-list popovers. */
const dueRow = `
<input type="hidden" id="as-due_on" data-voiceos-key="due_on" />
<input type="hidden" id="as-due_time" data-voiceos-key="due_time" />
<div class="as-row"><span class="as-lbl">Due</span><button type="button" class="as-val" data-menu="cal" id="as-due-btn" aria-expanded="false" aria-haspopup="dialog">${calIcon}<span></span>${chevron}</button><button type="button" class="as-val as-time" data-menu="due_time" data-none="No time" aria-expanded="false" aria-label="Due time" hidden><span></span>${chevron}</button></div>
<div class="as-pop" id="as-pop-cal" role="dialog" aria-label="Due date" hidden>
<div class="as-quick"><button type="button" class="as-c" data-q="today">Today</button><button type="button" class="as-c" data-q="tomorrow">Tomorrow</button><button type="button" class="as-c" data-q="mon">Next Mon</button><button type="button" class="as-clear" id="as-clear">Clear</button></div>
<div class="as-calh"><button type="button" id="as-prev" aria-label="Previous month">&lsaquo;</button><span id="as-month"></span><button type="button" id="as-next" aria-label="Next month">&rsaquo;</button></div><div class="as-grid" id="as-grid"></div>
</div>
<div class="as-pop" id="as-pop-due_time" hidden><div class="as-list" role="listbox" aria-label="Due time"></div></div>`;

/**
 * A list-backed field: a hidden input bound to the tool argument `key`, the
 * row's button, and its popover list. card.js fills the list from the
 * `<key>_choices` argument; `none` labels the empty choice.
 */
const menuRow = (key: string, label: string, none: string) => `
<input type="hidden" id="as-${key}" data-voiceos-key="${key}" />
<div class="as-row"><span class="as-lbl">${label}</span><button type="button" class="as-val" data-menu="${key}" data-none="${none}" aria-expanded="false"><span></span>${chevron}</button></div>
<div class="as-pop" id="as-pop-${key}" hidden><div class="as-list" role="listbox" aria-label="${label}"></div></div>`;

const page = (rows: string) => `<div class="as">\n${rows}\n</div>`;

const cards: Record<string, { markup: string; height: number }> = {
  create_task: {
    markup: page(`${header("New task")}
${notesField}
${dueRow}
${menuRow("project", "Project", "No project")}
${menuRow("section", "Section", "Default section")}`),
    height: 280,
  },
  update_task: {
    markup: page(`${header("Update task")}
${notesField}
${dueRow}
${menuRow("assignee", "Assignee", "Unassigned")}
${menuRow("project", "Project", "No project")}
${menuRow("section", "Section", "Keep section")}`),
    height: 310,
  },
};

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const [name, { markup, height }] of Object.entries(cards)) {
  // The card script must run before widgetKit's bridge script, which renderCustom appends after the body.
  const card = renderCustom({
    accent: "#f06a6a",
    css: read("card.css"),
    body: `${markup}\n<script>${read("card.js")}</script>`,
    mode: "confirm",
    height,
  });
  const root = manifest.tools.find((t: any) => t.name === name)?.confirmation?.root;
  if (!root) throw new Error(`${name} has no confirmation card in the manifest`);
  root.html = card.html;
  root.height = card.height;
  console.log(`${name} confirmation card: ${card.html.length} chars, height ${card.height}`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
