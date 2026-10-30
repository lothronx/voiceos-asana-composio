# Asana Tasks: handoff

This is a VoiceOS integration for Asana that goes through Composio (OAuth2, Composio-managed).
All runtime code is in `server.ts`. `AGENTS.md` has the file layout and the dev loop.

## Before you ship

1. Remove the temporary `COMPOSIO_API_KEY` Setup field from `preferences` in `voiceos.integration.json`.
2. Copy `.env.example` to `.env` and set your own `COMPOSIO_API_KEY` and `COMPOSIO_USER_ID`.
3. In platform.composio.dev, open Connected accounts and connect Asana for that user_id.
4. Run `bun test`.

## Differences from the spec

### 1. Four helper tools beyond the nine approved ones

The nine approved tools are `create_task`, `update_task`, `get_task`, `search_tasks`, `add_comment`,
`complete_task`, `create_project`, `delete_project` and `create_goal`.

There are four more tools. Users don't see them (`visibility: "agent"`), and none of them adds a new Asana
capability:

| Tool | Serves | Why it exists |
|---|---|---|
| `list_asana_options` | Create task / project / goal | It fetches the dropdown choices (projects, sections, teams, people, time periods). A confirmation card can only show what its arguments carry and cannot fetch data itself. |
| `find_asana_tasks` | Update task | It returns the task's current values, so the update card shows what will change. |
| `find_asana_projects` | Delete project | It counts the tasks that a delete would remove, so the card can warn about them. |
| `set_task_done` | Complete task | It completes a task when the user clicks the circle on a task card. A card-initiated approval would only show VoiceOS's raw-JSON dialog. Each card row has a signed token, so the agent cannot call this tool to skip confirmation. |

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
