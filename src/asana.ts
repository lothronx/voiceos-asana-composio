/**
 * The Asana operations the tools need, expressed as Composio tool calls.
 *
 * Depends only on an ExecuteTool function (see composio.ts), never on HTTP,
 * so tests pass a fake executor and server.ts passes the real one.
 * Composio wraps Asana's own response, so Asana's payload sits at `data.data`.
 */
import type { ExecuteTool } from "./composio.ts";
import { dueFields } from "./due.ts";

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
