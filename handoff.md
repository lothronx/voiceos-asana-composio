# Asana Tasks: handoff

This is a VoiceOS integration for Asana that goes through Composio (OAuth2, Composio-managed).
All runtime code is in `server.ts`. `AGENTS.md` has the file layout and the dev loop.

## Terms

- **Composio**: a third-party service. It stores each user's Asana OAuth token and runs Asana API calls for us. We
  never see the token.
- **user_id / connected account**: Composio files each linked Asana account under a user_id that you choose. Our calls
  send that user_id, and Composio picks the matching connected account.
- **Typed tool**: one of Composio's prebuilt Asana actions, such as `ASANA_CREATE_A_TASK`. Most of our calls use these.
- **Proxy**: a Composio endpoint that forwards a raw Asana REST request with the user's token. We use it where no
  typed tool works.
- **Confirmation card**: the editable card VoiceOS shows before a tool that changes data runs. It is defined in the
  manifest, and the user approves it.
- **`visibility: "agent"`**: the agent can call the tool, but users don't see it in VoiceOS.
- **Setup field**: a manifest `preferences` entry. Users fill it in on the integration's Setup page, and the server
  reads it as an environment variable.
- **`shortcut:` comment**: the comment we use in the code to mark a known limit and say when to fix it.

## Before you ship

1. Remove the temporary `COMPOSIO_API_KEY` Setup field from `preferences` in `voiceos.integration.json`.
2. Copy `.env.example` to `.env` and set your own `COMPOSIO_API_KEY` and `COMPOSIO_USER_ID`.
3. In platform.composio.dev, open Connected accounts and connect Asana for that user_id.
4. Run `bun test`.
5. Check `publisher` in `voiceos.integration.json`. It credits the original author as `{"id": "lothronx", "name": "Yue Wu"}`, in
   the same form as the bundled grokbot integration. Studio generated `pub_user` / "Made in VoiceOS" there, so make sure
   Publish accepts the new value, or change it to whatever your team uses.

## What we built

The user talks to VoiceOS. The agent picks one of the 9 approved tools below.

- Every tool that changes data first shows an editable confirmation card. The change runs only after the user
  approves it.
- After every call, the notch shows a result card, on success and on failure. The model also gets the data as JSON.

| Approved | Tool | What the user can do | Helper the agent calls first |
|---|---|---|---|
| Create task | `create_task` | Create a task in My Tasks: name, description, due date + time, project, My Tasks section. | `list_asana_options` (`kind: "task"`) |
| Update task | `update_task` | Change any of the user's own tasks: name, description, due date/time, assignee (or unassign), project, section. Only fields that differ are written. | `find_asana_tasks` |
| Get task | `get_task` | See one task (by id or name): description, due date, assignee, projects, section, tags, subtask progress, latest comments. If the name matches several tasks, the card lists them to pick from. | none |
| Search tasks | `search_tasks` | Search the workspace by text, assignee, project, due date range, open/completed. Up to 20 results, open tasks first. Rows expand in place. | none |
| Add story/comment | `add_comment` | Post a comment on a task. | none |
| Complete task | `complete_task` | Complete or reopen a task by voice. The circle on task cards does the same in one click. | none (`set_task_done` handles the circle) |
| Create project | `create_project` | Create a project: name, description, due date, team, default view (list/board/calendar). | `list_asana_options` (`kind: "project"`) |
| Delete project | `delete_project` | Delete a project. The card says how many tasks go with it, and the server re-checks the name and that count before deleting. | `find_asana_projects` |
| Create goal | `create_goal` | Create a goal: name, description, due date, owner (defaults to the user), time period. | `list_asana_options` (`kind: "goal"`) |

## Current status

- **All 9 tools work end to end against a real Asana workspace**, run through MCP with VoiceOS's bundled Bun. Each
  one was tested that way. 78 unit tests pass (`bun test`).
- **Measured times** (one user, US network, includes Composio):
  - Creating a task: about 4 s from the lookup to the result.
  - Rescheduling a task: about 1.7 s.
  - Clicking the circle: about 1 s, and the card shows the change right away.
  - Deleting a project: about 2.7 s.
- **Not tested:** a real expired or revoked token. The error messages are covered by unit tests only.

## Differences from the spec

### 1. Four helper tools beyond the nine approved ones

The helper column above names four more tools. Users don't see them (`visibility: "agent"`), and none of them adds a new Asana
capability:

| Tool | Serves | Why it exists |
|---|---|---|
| `list_asana_options` | Create task / project / goal | It fetches the dropdown choices (projects, sections, teams, people, time periods). A confirmation card can only show what its arguments carry and cannot fetch data itself. |
| `find_asana_tasks` | Update task | It returns the task's current values, so the update card shows what will change. |
| `find_asana_projects` | Delete project | It counts the tasks that a delete would remove, so the card can warn about them. |
| `set_task_done` | Complete task | It completes a task when the user clicks the circle on a task card. If the click went through `complete_task`, VoiceOS would ask for approval in a dialog that shows raw JSON. So the click calls this tool, which has no confirmation card. Each task row on a card carries a token that the server signs with a secret only it knows, and the tool refuses any call without a valid token. That way the agent can't use it to skip the confirmation step. |

### 2. Connect and disconnect happen in the Composio dashboard

Custom integrations can't use VoiceOS's native connect toggle. Users link Asana in platform.composio.dev. When the
link is missing, expired or revoked, the tool error says which one and where to reconnect.

## Things that will surprise you

- **Composio's typed tools drop `null`.**
  - To clear a due date, send `due_at: ""`.
  - Unassigning a task uses the Composio proxy, which keeps `null`.
  - Read the object back after a write instead of trusting the request.
- **Goals go through the proxy.** Composio has no create-goal tool. Asana returns no link for a goal.
- **Deleting a project doesn't delete all of its tasks.** Asana deletes only the tasks that are unassigned and in no
  other project. Assigned tasks stay in My Tasks. Subtasks go with their parent task, even assigned ones. The card's count
  doesn't include them. We checked this against real Asana.
- **Search depends on the Asana plan.** Advanced search needs a paid plan. On a free plan, search falls back to
  matching task names only. A brand-new task takes about a minute to show up in search.
- **The server checks every card before writing.** Card labels come from the agent, so the server confirms that each
  picked id exists, that the card showed its real name, and that the task or project name still matches.
- **Lists stop at 100.** Each spot where that happens has a `shortcut:` comment in the code.

## Dev notes

- Publish ships only `server.ts`, `widgetKit.ts`, `voiceos.integration.json`, `package.json` and `icon.png`.
- To change a confirmation card, edit `confirm-card/` and run `bun confirm-card/build.ts`.
- VoiceOS caches the manifest in `~/Library/Application Support/VoiceOS/config.json`. If a manifest edit doesn't
  show up, quit VoiceOS and update both of these:
  - `installedIntegrations[].manifest`
  - `customMcpServers[].confirmTools`
- From a VS Code terminal, launch VoiceOS with `ELECTRON_RUN_AS_NODE` unset. Otherwise it exits silently.
