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

The four helpers have `visibility: "agent"`. They are lookups, not extra features.

- **Why the agent looks things up first:** a confirmation card can only show what the tool's arguments carry, and it
  cannot fetch data itself. So the agent fetches the choices first (projects, sections, teams, people, time periods,
  how many tasks a delete removes).
- **Why `set_task_done` exists:** it lets a user complete a task by clicking the circle on a task card. If a card
  started an approval itself, VoiceOS would show a raw-JSON dialog. Instead, each card row carries a signed token, and
  `set_task_done` refuses calls without it, so the agent cannot use it to skip confirmation.

## How each requirement is met

- **OAuth2 connect/disconnect:** in the **Composio dashboard**, not in VoiceOS. Custom integrations cannot use
  VoiceOS's native connect toggle, so this was a deliberate decision.
- **Confirmation before Delete project:** the card shows how many tasks will be deleted along with the project. Before
  deleting, the server reads the project name and that count again, and deletes nothing if either changed.
- **Success/error feedback for writes:** every write returns a notch result card (VoiceOS's "glance" card), both on
  success and on failure.
- **Loading states:** the host shows them during voice tool calls. On cards, an expanding row shows "Loading…", and
  the circle flips right away, then rolls back if the write fails.
- **Expired or revoked token:**
  - Errors say which problem it is: "not connected yet", "expired", or "revoked/disabled". They also say where to
    reconnect.
  - Composio refreshes the tokens.
  - These errors are covered by unit tests only. A real expired token was never tested.

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
