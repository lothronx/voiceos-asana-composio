process.env.TZ = "America/Chicago";
import { expect, test } from "bun:test";
import { createAsana, localDue, type ExecuteTool } from "../server.ts";

/** The task as Asana stores it before the update. */
const LIVE = {
  gid: "42",
  name: "Call Eric",
  notes: "",
  due_on: "2026-10-31",
  due_at: null,
  assignee: { gid: "me1", name: "Yue" },
  assignee_section: { gid: "s1", name: "Recently assigned" },
  projects: [{ gid: "p1", name: "Launch" }],
  permalink_url: "https://app.asana.com/x",
};

/** A fake Composio that serves LIVE (as changed by the update) and records every write. */
function fakeAsana(fail: Record<string, string> = {}) {
  const calls: { slug: string; args: any }[] = [];
  let state: any = structuredClone(LIVE);
  const execute: ExecuteTool = async (slug, args) => {
    calls.push({ slug, args });
    if (fail[slug]) throw new Error(fail[slug]);
    switch (slug) {
      case "ASANA_GET_A_TASK": return { data: structuredClone(state) };
      // Real lists the server verifies the card's picks against.
      case "ASANA_GET_MULTIPLE_WORKSPACES": return { data: [{ gid: "w", name: "W" }] };
      case "ASANA_GET_A_USER_TASK_LIST": return { data: { gid: "ml", owner: { gid: "me1" } } };
      case "ASANA_GET_MULTIPLE_PROJECTS": return { data: [{ gid: "p1", name: "Launch" }, { gid: "p2", name: "Personal" }] };
      case "ASANA_GET_SECTIONS_IN_PROJECT": return { data: [{ gid: "s1", name: "Recently assigned" }, { gid: "s2", name: "Today" }] };
      case "ASANA_GET_USERS_FOR_WORKSPACE": return { data: [{ gid: "me1", name: "Yue" }, { gid: "u9", name: "Sam" }] };
      case "ASANA_UPDATE_A_TASK":
        state = {
          ...state,
          ...args.data,
          assignee: "assignee" in args.data ? (args.data.assignee ? { gid: args.data.assignee, name: "Someone" } : null) : state.assignee,
          assignee_section: args.data.assignee_section ? { gid: args.data.assignee_section, name: "Today" } : state.assignee_section,
        };
        return { data: {} };
      case "ASANA_ADD_PROJECT_FOR_TASK": state.projects = [{ gid: args.project, name: "New project" }, ...state.projects]; return { data: {} };
      case "ASANA_REMOVE_PROJECT_FROM_TASK": state.projects = state.projects.filter((p: any) => p.gid !== args.project); return { data: {} };
    }
    throw new Error(`unexpected ${slug}`);
  };
  const writes = () => calls.filter((c) => !c.slug.startsWith("ASANA_GET_"));
  return { execute, calls, writes };
}

const update = (fake: ReturnType<typeof fakeAsana>, input: object) =>
  createAsana(fake.execute).updateTask({ task_gid: "42", ...input });

test("only fields that differ from the live task are sent, in one update call", async () => {
  const fake = fakeAsana();
  const result = await update(fake, { name: "Call Eric", notes: "agenda", due_on: "2026-11-02", due_time: "9:00", project: "p1", section: "s1" });

  expect(fake.writes()).toEqual([
    { slug: "ASANA_UPDATE_A_TASK", args: { task_gid: "42", data: { notes: "agenda", due_at: "2026-11-02T15:00:00.000Z" } } },
  ]);
  expect(result.changed).toEqual(["description", "due date"]);
});

test("passing the current values back changes nothing and writes nothing", async () => {
  const fake = fakeAsana();
  const result = await update(fake, { name: "Call Eric", notes: "", due_on: "2026-10-31", due_time: "", assignee: "me1", project: "p1", section: "s1" });
  expect(fake.writes()).toEqual([]);
  expect(result.changed).toEqual([]);
});

test("absent fields are kept; an empty due date clears it with due_at \"\" (Composio drops null)", async () => {
  const fake = fakeAsana();
  await update(fake, { due_on: "" });
  expect(fake.writes()[0].args.data).toEqual({ due_at: "" });
});

test("a date without a time is sent as due_on alone, which clears an existing time", async () => {
  const fake = fakeAsana();
  await update(fake, { due_on: "2026-11-05", due_time: "" });
  expect(fake.writes()[0].args.data).toEqual({ due_on: "2026-11-05" });
});

test("unassigning goes through the proxy with assignee: null; a proxy failure is a warning", async () => {
  const fake = fakeAsana();
  const proxied: any[] = [];
  const asana = createAsana(fake.execute, { proxy: async (...args) => { proxied.push(args); return {}; } });
  const result = await asana.updateTask({ task_gid: "42", assignee: "" });
  expect(proxied).toEqual([["asana", "PUT", "https://app.asana.com/api/1.0/tasks/42", { data: { assignee: null } }]]);
  expect(fake.writes()).toEqual([]);
  expect(result.changed).toEqual(["assignee"]);

  const failing = createAsana(fakeAsana().execute, { proxy: async () => { throw new Error("Forbidden"); } });
  const failed = await failing.updateTask({ task_gid: "42", assignee: "" });
  expect(failed.changed).toEqual([]);
  expect(failed.warning).toBe("Task updated, but unassigning it failed: Forbidden.");
});

test("a new project is added before the old one is removed; '' removes it", async () => {
  const moved = fakeAsana();
  await update(moved, { project: "p2" });
  expect(moved.writes().map((c) => `${c.slug} ${c.args.project}`)).toEqual([
    "ASANA_ADD_PROJECT_FOR_TASK p2",
    "ASANA_REMOVE_PROJECT_FROM_TASK p1",
  ]);

  const removed = fakeAsana();
  const result = await update(removed, { project: "" });
  expect(removed.writes().map((c) => c.slug)).toEqual(["ASANA_REMOVE_PROJECT_FROM_TASK"]);
  expect(result.task.project).toBe("");
});

test("the section moves in the same update call, but not when the task is reassigned", async () => {
  const mine = fakeAsana();
  const moved = await update(mine, { section: "s2" });
  expect(mine.writes()).toEqual([{ slug: "ASANA_UPDATE_A_TASK", args: { task_gid: "42", data: { assignee_section: "s2" } } }]);
  expect(moved.task.section).toBe("Today");

  const reassigned = fakeAsana();
  const result = await update(reassigned, { assignee: "u9", section: "s2" });
  expect(reassigned.writes().map((c) => c.slug)).toEqual(["ASANA_UPDATE_A_TASK"]);
  expect(result.warning).toContain("left your My Tasks");
});

test("a failed project move after a successful update is a warning, not an error", async () => {
  const fake = fakeAsana({ ASANA_ADD_PROJECT_FOR_TASK: "project not found" });
  const result = await update(fake, { name: "Call Eric today", project: "p2" });
  expect(result.changed).toEqual(["name"]);
  expect(result.warning).toBe("Task updated, but moving it to the project failed: project not found.");
  expect(fake.writes().map((c) => c.slug)).not.toContain("ASANA_REMOVE_PROJECT_FROM_TASK");
});

test("a failed main update throws (nothing was changed)", async () => {
  const fake = fakeAsana({ ASANA_UPDATE_A_TASK: "Not Authorized" });
  expect(update(fake, { name: "x" })).rejects.toThrow("Not Authorized");
});

test("localDue shows a timed due date in local time and a plain date as is", () => {
  expect(localDue({ due_at: "2026-10-31T22:30:00.000Z" })).toEqual({ due_on: "2026-10-31", due_time: "17:30" });
  expect(localDue({ due_on: "2026-10-31", due_at: null })).toEqual({ due_on: "2026-10-31", due_time: "" });
});

test("findTasks ranks exact, prefix, substring and all-words matches and returns update-shaped values", async () => {
  const tasks = [
    { gid: "1", name: "Prep meeting with Eric notes", due_on: null, due_at: null, projects: [] },
    { gid: "2", name: "Meeting with Eric", due_on: null, due_at: "2026-10-31T22:30:00.000Z", projects: [{ gid: "p1" }], assignee: { gid: "me1" }, assignee_section: { gid: "s1" }, notes: "n" },
    { gid: "3", name: "Groceries", projects: [] },
    { gid: "4", name: "Follow up with Eric after the meeting", projects: [] },
  ];
  const execute: ExecuteTool = async (slug) => {
    const answers: Record<string, any> = {
      ASANA_GET_MULTIPLE_WORKSPACES: { data: [{ gid: "w", name: "W" }] },
      ASANA_GET_A_USER_TASK_LIST: { data: { gid: "ml" } },
      ASANA_GET_MULTIPLE_PROJECTS: { data: [{ gid: "p1", name: "Launch" }] },
      ASANA_GET_SECTIONS_IN_PROJECT: { data: [{ gid: "s1", name: "Today" }] },
      ASANA_GET_TASKS_FOR_USER_TASK_LIST: { data: tasks },
      ASANA_GET_USERS_FOR_WORKSPACE: { data: [{ gid: "me1", name: "Yue" }] },
    };
    return answers[slug];
  };
  const found = await createAsana(execute).findTasks("meeting with eric");

  expect(found.tasks.map((t) => t.task_gid)).toEqual(["2", "1", "4"]);
  expect(found.tasks[0]).toEqual({
    task_gid: "2", name: "Meeting with Eric", notes: "n", due_on: "2026-10-31", due_time: "17:30",
    assignee: "me1", project: "p1", section: "s1",
  });
  expect(found.assignee_choices).toEqual([{ gid: "me1", name: "Yue" }]);
});

test("a task that isn't assigned to the user is refused before any write", async () => {
  const fake = fakeAsana();
  const asana = createAsana(async (slug, args) =>
    slug === "ASANA_GET_A_TASK" ? { data: { ...LIVE, assignee: { gid: "someone-else" } } } : fake.execute(slug, args));
  expect(asana.updateTask({ task_gid: "42", name: "Renamed" })).rejects.toThrow("isn't assigned to you");
  expect(fake.writes()).toEqual([]);
});

test("a pick the card labeled wrongly is refused before any write", async () => {
  const fake = fakeAsana();
  // The card labeled p2 "Launch", but p2 is really "Personal".
  const mislabeled = update(fake, { name: "Renamed", project: "p2", project_choices: [{ gid: "p2", name: "Launch" }] });
  expect(mislabeled).rejects.toThrow(`The card showed project "Launch", but it is "Personal". Nothing was changed.`);
  await mislabeled.catch(() => {});
  expect(fake.writes()).toEqual([]);

  const unknown = fakeAsana();
  expect(update(unknown, { assignee: "u404" })).rejects.toThrow("There is no assignee u404");
});
