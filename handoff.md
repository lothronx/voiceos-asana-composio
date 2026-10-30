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

## Approved tools

| Approved | Tool | Confirmation card | Helper the agent calls first |
|---|---|---|---|
| Create task | `create_task` | yes | `list_asana_options` (`kind: "task"`) |
| Update task | `update_task` | yes | `find_asana_tasks` |
| Get task | `get_task` | no (read-only) | none |
| Search tasks | `search_tasks` | no (read-only) | none |
| Add story/comment | `add_comment` | yes | none |
| Complete task | `complete_task` | yes | none (`set_task_done` is the circle on task cards) |
| Create project | `create_project` | yes | `list_asana_options` (`kind: "project"`) |
| Delete project | `delete_project` | yes | `find_asana_projects` |
| Create goal | `create_goal` | yes | `list_asana_options` (`kind: "goal"`) |

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
  other project. Assigned tasks stay in My Tasks. We checked this against real Asana.
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
