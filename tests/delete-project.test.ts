import { expect, test } from "bun:test";
import { createAsana, type ExecuteTool } from "../server.ts";

// Launch: 4 tasks; one also in Finance and one assigned survive the delete. Finance: more than a page.
const TASKS: Record<string, any> = {
  p1: { data: [
    { projects: [{ gid: "p1" }], assignee: null }, { projects: [{ gid: "p1" }], assignee: null },
    { projects: [{ gid: "p1" }, { gid: "p2" }], assignee: null }, { projects: [{ gid: "p1" }], assignee: { gid: "me1" } },
  ] },
  p2: { data: Array.from({ length: 100 }, () => ({ projects: [{ gid: "p2" }] })), next_page: { offset: "x" } },
  p3: { data: [] },
};

/** A fake Composio with three projects; records every call. */
function fakeAsana(names: Record<string, string> = {}) {
  const calls: { slug: string; args: any }[] = [];
  const execute: ExecuteTool = async (slug, args) => {
    calls.push({ slug, args });
    switch (slug) {
      case "ASANA_GET_MULTIPLE_WORKSPACES": return { data: [{ gid: "w", name: "W" }] };
      case "ASANA_GET_A_USER_TASK_LIST": return { data: { gid: "ml", owner: { gid: "me1" } } };
      case "ASANA_GET_SECTIONS_IN_PROJECT": return { data: [] };
      case "ASANA_GET_MULTIPLE_PROJECTS": return { data: [{ gid: "p1", name: "Launch" }, { gid: "p2", name: "Finance" }, { gid: "p3", name: "Launch retro" }] };
      case "ASANA_GET_TASKS_FROM_A_PROJECT": return TASKS[args.project_gid];
      case "ASANA_GET_A_PROJECT": return { data: { gid: args.project_gid, name: names[args.project_gid] ?? { p1: "Launch", p2: "Finance", p3: "Launch retro" }[args.project_gid as string] } };
      case "ASANA_DELETE_PROJECT": return { data: {} };
    }
    throw new Error(`unexpected ${slug}`);
  };
  return { execute, calls };
}

const deleted = (calls: { slug: string }[]) => calls.some((c) => c.slug === "ASANA_DELETE_PROJECT");

test("find counts only unassigned tasks in no other project, best name match first", async () => {
  const { projects } = await createAsana(fakeAsana().execute).findProjects("launch");
  expect(projects).toEqual([
    { project_gid: "p1", project_name: "Launch", tasks_deleted: "2 tasks" },
    { project_gid: "p3", project_name: "Launch retro", tasks_deleted: "No tasks" },
  ]);
});

test("a project with more than a page of tasks says so", async () => {
  const { projects } = await createAsana(fakeAsana().execute).findProjects("Finance");
  expect(projects[0].tasks_deleted).toBe("100+ tasks");
});

test("delete runs only when the card's name and task count are still true", async () => {
  const fake = fakeAsana();
  const result = await createAsana(fake.execute).deleteProject({ project_gid: "p1", project_name: "Launch", tasks_deleted: "2 tasks" });
  expect(fake.calls.find((c) => c.slug === "ASANA_DELETE_PROJECT")?.args).toEqual({ project_gid: "p1" });
  expect(result).toMatchObject({ gid: "p1", name: "Launch", details: ["2 tasks deleted"] });
});

test("a wrong name, a blank name or a stale task count deletes nothing", async () => {
  const fake = fakeAsana();
  const asana = createAsana(fake.execute);
  expect(asana.deleteProject({ project_gid: "p1", project_name: "Finance", tasks_deleted: "2 tasks" })).rejects.toThrow(`The card showed project "Finance", but that project is "Launch"`);
  expect(asana.deleteProject({ project_gid: "p1", project_name: " ", tasks_deleted: "2 tasks" })).rejects.toThrow("didn't say which project");
  expect(asana.deleteProject({ project_gid: "p1", project_name: "Launch", tasks_deleted: "No tasks" })).rejects.toThrow(`The card said "No tasks", but it would delete 2 tasks`);
  await Bun.sleep(0);
  expect(deleted(fake.calls)).toBe(false);
});
