# Asana Tasks: handoff

A VoiceOS integration that lets the agent work with Asana through Composio (OAuth2, Composio-managed).
Everything that runs is in `server.ts`. `AGENTS.md` describes the file layout and the dev loop.

## Before you ship

1. **Remove the temporary `COMPOSIO_API_KEY` Setup field.** It is in `voiceos.integration.json` → `preferences` and is
   only there for testing. Keep `ASANA_WORKSPACE_GID`.
2. **Use your own Composio project.** Copy `.env.example` to `.env`, then set `COMPOSIO_API_KEY` and
   `COMPOSIO_USER_ID` (the default is `default`).
   In platform.composio.dev → Connected accounts, connect Asana for that user_id. `.env` is never published or
   committed.
3. **Run `bun test`.** All 78 tests should pass.

## Approved tools → what is registered

| Approved | Tool | Confirmation card | Helper the agent calls first |
|---|---|---|---|
| Create task | `create_task` | yes | `list_asana_options` (kind `task`) |
| Update task | `update_task` | yes | `find_asana_tasks` |
| Get task | `get_task` | no (read-only) | — |
| Search tasks | `search_tasks` | no (read-only) | — |
| Add story/comment | `add_comment` | yes | — |
| Complete task | `complete_task` | yes | — (`set_task_done` is the card's circle) |
| Create project | `create_project` | yes | `list_asana_options` (kind `project`) |
| Delete project | `delete_project` | yes | `find_asana_projects` |
| Create goal | `create_goal` | yes | `list_asana_options` (kind `goal`) |

## Differences from the spec

### 1. Four extra tools beyond the nine approved ones

The spec says "no others". We register 13 tools: the 9 approved ones plus 4 helpers. The helpers are hidden from the
user (`visibility: "agent"`). They add no new Asana capability; each one only serves an approved tool.

| Extra tool | What it does | Serves | Why it is needed |
|---|---|---|---|
| `list_asana_options` | Read-only. Returns the choices a card offers: projects + My Tasks sections (`kind: "task"`), teams + views (`"project"`), people + time periods (`"goal"`). | Create task, Create project, Create goal | A confirmation card can only show what the tool's arguments carry; it cannot fetch data. Without this lookup the card's dropdowns would be empty. |
| `find_asana_tasks` | Read-only. Finds the user's open tasks by name and returns each one's current values, already shaped as `update_task` arguments, plus the dropdown choices. | Update task | The update card has to show the task's current values so the user sees what changes. `search_tasks` returns a different shape and covers the whole workspace, while updates are limited to the user's own tasks. |
| `find_asana_projects` | Read-only. Finds projects by name and counts how many tasks deleting each would remove. | Delete project | The delete card must say how many tasks go with the project. That count has to come from Asana before the card opens. |
| `set_task_done` | Completes or reopens a task when the user clicks the circle on a task card. | Complete task | If a card started an approval itself, VoiceOS would show a raw-JSON dialog. Each card row carries a signed token, and `set_task_done` refuses any call without a valid one, so the agent cannot use it to skip confirmation. Completing by voice still goes through `complete_task` and its card. |

The 4 extra tools can be removed only by giving up what they serve: working dropdowns, current values on the update
card, the delete warning count, and one-click completion.

### 2. Connect/disconnect is in the Composio dashboard, not in VoiceOS

The spec asks for an Asana connect/disconnect UI. Custom integrations cannot use VoiceOS's native connect toggle, so
linking happens in platform.composio.dev → Connected accounts. OAuth2 itself runs through Composio end to end.

### 3. "Toasts" are notch result cards

Every write returns a result card in the notch (VoiceOS's "glance" card), both on success and on failure. VoiceOS has
no separate toast for integrations.

### 4. Loading states are mostly the host's

During voice tool calls, VoiceOS shows the loading state. On our cards, an expanding row shows "Loading…", and the
circle flips right away, then rolls back if the write fails.

### 5. Token refresh is Composio's, and expiry was not tested live

- Composio refreshes the tokens.
- Errors say which problem it is: "not connected yet", "expired", or "revoked/disabled". They also say where to
  reconnect.
- These errors are covered by unit tests only. A real expired token was never tested.

Confirmation before Delete project is met as written: the card shows how many tasks will be deleted with the project.
Before deleting, the server reads the project name and that count again, and deletes nothing if either changed.

## Asana and Composio behaviour you would not guess

- **Composio's typed tools silently drop `null`.**
  - To clear a due date, send `due_at: ""`.
  - To unassign a task, call Asana directly through the Composio proxy, which keeps `null`.
  - Always read the object back after a write instead of trusting the request.
- **The proxy needs `connected_account_id` and `user_id`.** The project has 2FA enforced. The account id is cached
  until a call fails.
- **Goals are created through the proxy** (`POST /goals`), because Composio has no create-goal tool. Asana returns no
  link for a goal, so the goal result card has no Open button.
- **Delete project removes only part of the project's tasks.** Asana deletes the tasks that are unassigned and in no
  other project, a few seconds later. Assigned tasks stay in the assignee's My Tasks. This was checked against real
  Asana, and the card's count follows the same rule.
- **Search depends on the Asana plan and has a short lag.**
  - Advanced search (task names and descriptions) needs a paid Asana plan. On a free plan, search falls back to
    name-only typeahead and says so.
  - New tasks take about a minute to appear in search, so an empty text search retries with typeahead.

## Security choices

- **Card labels come from the agent, so writes check them first.** Before writing, the server checks that every
  picked id exists and that the card showed its real name. Picked values with leading or trailing spaces are refused.
- **Some tools must name their target.** Update, comment, complete, and delete check the card's task or project name
  against Asana and refuse if the name is blank or does not match.
- **`update_task` is limited to tasks assigned to the user.**
- **Asana text is untrusted.** Task names, descriptions, and comments are marked as untrusted data in the results the
  model reads.

## Known limits

Each limit is marked with a `shortcut:` comment in the code.

- **Lists cap at 100 items.**
  - Only the first 100 projects are listed, so archived projects and projects past that point cannot be found by voice.
  - `find_asana_tasks` sees the first 100 open tasks in My Tasks.
  - A delete counts tasks among the first 100 and shows "100+" when there are more.
- **Subtasks are not counted** in the delete card. Whether Asana deletes them along with their parent task was not
  tested.
- **Old tasks may show old comments.** `get_task` reads the first 100 stories, so a task with more than 100 events
  shows older comments.

## Dev notes

- **Publish ships only five files:** `server.ts`, `widgetKit.ts`, `voiceos.integration.json`, `package.json` and
  `icon.png`. Keep all runtime code in `server.ts`.
- **VoiceOS runs the server with its bundled Bun 1.3**, which has no `process.loadEnvFile`. That is why `.env` is
  parsed by hand.
- **Confirmation cards are generated.** Edit `confirm-card/`, then run `bun confirm-card/build.ts` to rewrite the card
  HTML in the manifest.
- **VoiceOS caches the manifest.** It is stored in `~/Library/Application Support/VoiceOS/config.json` under
  `installedIntegrations[].manifest`, and the tools that need a confirmation are listed in
  `customMcpServers[].confirmTools`.
  - If manifest edits (cards, the tool list) do not show up, quit VoiceOS and update both entries.
  - When launching VoiceOS from a VS Code terminal, unset `ELECTRON_RUN_AS_NODE`, or VoiceOS exits silently.
