process.env.TZ = "America/Chicago";
import { expect, test } from "bun:test";
import { ComposioError, createAsana, type ExecuteTool } from "../server.ts";

const TASKS = [
  { gid: "1", name: "Ship launch post", completed: false, due_on: "2026-11-05", assignee: { gid: "me1", name: "Yue" }, projects: [{ gid: "p1", name: "Launch" }] },
  { gid: "2", name: "Launch retro", completed: true, due_on: "2026-11-01", assignee: { gid: "me1", name: "Yue" }, projects: [{ gid: "p1", name: "Launch" }] },
  { gid: "3", name: "Book launch venue", completed: false, due_at: "2026-11-02T15:00:00.000Z", assignee: { gid: "u9", name: "Sam" }, projects: [] },
  { gid: "4", name: "Launch budget", completed: false, due_on: null, assignee: null, projects: [{ gid: "p2", name: "Finance" }] },
];

/** A fake Composio whose search returns TASKS (or fails like a free plan), recording calls. */
function fakeAsana(opts: { paywalled?: boolean; searchError?: Error; notIndexedYet?: boolean } = {}) {
  const calls: { slug: string; args: any }[] = [];
  const execute: ExecuteTool = async (slug, args) => {
    calls.push({ slug, args });
    switch (slug) {
      case "ASANA_GET_MULTIPLE_WORKSPACES": return { data: [{ gid: "w", name: "W" }] };
      case "ASANA_GET_A_USER_TASK_LIST": return { data: { gid: "ml", owner: { gid: "me1" } } };
      case "ASANA_GET_MULTIPLE_PROJECTS": return { data: [{ gid: "p1", name: "Launch" }, { gid: "p2", name: "Finance" }] };
      case "ASANA_GET_SECTIONS_IN_PROJECT": return { data: [] };
      case "ASANA_SEARCH_TASKS_IN_WORKSPACE":
        if (opts.searchError) throw opts.searchError;
        if (opts.paywalled) throw new ComposioError("Search is only available to premium users", "tool", 402);
        return { data: opts.notIndexedYet ? [] : TASKS };
      case "ASANA_GET_TYPEAHEAD_OBJECTS": return { data: TASKS };
    }
    throw new Error(`unexpected ${slug}`);
  };
  return { execute, calls };
}

const ids = (r: { tasks: { gid: string }[] }) => r.tasks.map((t) => t.gid);

test("open tasks only by default, sorted by due date with undated last", async () => {
  const result = await createAsana(fakeAsana().execute).searchTasks({ query: "launch" });
  expect(ids(result)).toEqual(["3", "1", "4"]);
  expect(result.tasks[0]).toEqual({
    gid: "3", name: "Book launch venue", completed: false, due: "2026-11-02 09:00", assignee: "Sam", projects: [],
    permalink_url: "https://app.asana.com/0/0/3",
  });
});

test("completed tasks come back on request, after the open ones", async () => {
  const result = await createAsana(fakeAsana().execute).searchTasks({ query: "launch", include_completed: true });
  expect(ids(result)).toEqual(["3", "1", "4", "2"]);
});

test("due range, assignee and project filter locally; project names resolve to gids", async () => {
  const fake = fakeAsana();
  const asana = createAsana(fake.execute);
  expect(ids(await asana.searchTasks({ due_after: "2026-11-02", due_before: "2026-11-04" }))).toEqual(["3"]);
  expect(ids(await asana.searchTasks({ assignee: "me" }))).toEqual(["1"]);
  expect(ids(await asana.searchTasks({ project: "finance" }))).toEqual(["4"]);
  expect(fake.calls.filter((c) => c.slug === "ASANA_SEARCH_TASKS_IN_WORKSPACE").map((c) => c.args)).toEqual([
    { workspace_gid: "w", limit: 100, opt_fields: expect.any(Array), resource_subtype: "default_task" },
    { workspace_gid: "w", limit: 100, opt_fields: expect.any(Array), assignee_any: ["me"] },
    { workspace_gid: "w", limit: 100, opt_fields: expect.any(Array), projects_any: ["p2"] },
  ]);
});

test("an unknown project is an error that lists the real ones", async () => {
  expect(createAsana(fakeAsana().execute).searchTasks({ project: "Marketing" })).rejects.toThrow(`No project named "Marketing". Projects: Launch, Finance.`);
});

test("a free plan (402) falls back to name-only typeahead, with the same filters and a note", async () => {
  const fake = fakeAsana({ paywalled: true });
  const result = await createAsana(fake.execute).searchTasks({ query: "launch", assignee: "me" });
  expect(ids(result)).toEqual(["1"]);
  expect(result.note).toContain("only task names were searched");
  expect(fake.calls.at(-1)?.slug).toBe("ASANA_GET_TYPEAHEAD_OBJECTS");
});

test("other search failures are not hidden behind the fallback", async () => {
  const fake = fakeAsana({ searchError: new ComposioError("Not Authorized", "tool", 401) });
  expect(createAsana(fake.execute).searchTasks({ query: "launch" })).rejects.toThrow("Not Authorized");
});

test("getTask merges fields, subtasks and the latest three real comments", async () => {
  const execute: ExecuteTool = async (slug) => ({
    ASANA_GET_A_TASK: { data: {
      gid: "42", name: "Call Eric", notes: "agenda " + "x".repeat(3000), completed: false, due_at: "2026-10-31T22:30:00.000Z",
      assignee: { name: "Yue" }, assignee_section: { name: "Today" }, projects: [{ name: "Launch" }], tags: [{ name: "urgent" }],
      parent: null, created_at: "c", modified_at: "m", permalink_url: "https://app.asana.com/x",
    } },
    ASANA_GET_TASK_SUBTASKS: { data: [{ name: "Book room", completed: true }, { name: "Send invite", completed: false }] },
    ASANA_GET_STORIES_FOR_TASK: { data: [
      { resource_subtype: "comment_added", created_by: { name: "A" }, text: "one", created_at: "1" },
      { resource_subtype: "due_date_changed", created_by: { name: "B" }, text: "changed the due date", created_at: "2" },
      { resource_subtype: "comment_added", created_by: { name: "C" }, text: "two", created_at: "3" },
      { resource_subtype: "comment_added", created_by: { name: "D" }, text: "three", created_at: "4" },
      { resource_subtype: "comment_added", created_by: { name: "E" }, text: "four", created_at: "5" },
    ] },
  } as Record<string, any>)[slug];
  const task = await createAsana(execute).getTask("42");
  expect(task.notes).toHaveLength(3007); // descriptions are never cut: update_task may write them back
  expect(task).toMatchObject({
    name: "Call Eric", due: "2026-10-31 17:30", assignee: "Yue", section: "Today",
    projects: ["Launch"], tags: ["urgent"], parent: "",
    subtasks: [{ name: "Book room", completed: true }, { name: "Send invite", completed: false }],
  });
  expect(task.comments.map((c) => c.text)).toEqual(["two", "three", "four"]);
});

test("a text search with no hits retries typeahead, which sees brand-new tasks", async () => {
  const fake = fakeAsana({ notIndexedYet: true });
  const result = await createAsana(fake.execute).searchTasks({ query: "launch" });
  expect(ids(result)).toEqual(["3", "1", "4"]);
  expect(result.note).toBeUndefined();
  expect(fake.calls.at(-1)?.slug).toBe("ASANA_GET_TYPEAHEAD_OBJECTS");
});
