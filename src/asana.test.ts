process.env.TZ = "America/Chicago";
import { expect, test } from "bun:test";
import { createAsana } from "./asana.ts";
import type { ExecuteTool } from "./composio.ts";

/** A fake Composio: records every call and answers from a slug → handler table. */
function fakeComposio(answers: Record<string, (args: any) => any>) {
  const calls: { slug: string; args: any }[] = [];
  const execute: ExecuteTool = async (slug, args) => {
    calls.push({ slug, args });
    const answer = answers[slug];
    if (!answer) throw new Error(`unexpected tool ${slug}`);
    return answer(args);
  };
  return { execute, calls };
}

const WORKSPACES = { ASANA_GET_MULTIPLE_WORKSPACES: () => ({ data: [{ gid: "1", name: "Main" }] }) };
const created = (extra: object = {}) => () => ({
  data: { gid: "42", name: "Call Eric", assignee_section: { name: "Recently assigned" }, ...extra },
});

test("creates the task for me in the first workspace, with due time in UTC and the project", async () => {
  const { execute, calls } = fakeComposio({ ...WORKSPACES, ASANA_CREATE_A_TASK: created({ due_at: "x" }) });
  await createAsana(execute).createTask({ name: "Call Eric", due_on: "2026-10-31", due_time: "9:00", project: "77" });

  expect(calls.find((c) => c.slug === "ASANA_CREATE_A_TASK")?.args).toEqual({
    data: { name: "Call Eric", assignee: "me", workspace: "1", due_at: "2026-10-31T14:00:00.000Z", projects: ["77"] },
  });
});

test("moves the task into the chosen section and reports that section's name", async () => {
  const { execute, calls } = fakeComposio({
    ...WORKSPACES,
    ASANA_CREATE_A_TASK: created(),
    ASANA_ADD_TASK_TO_SECTION: () => ({ data: {} }),
  });
  const result = await createAsana(execute).createTask({
    name: "Call Eric",
    section: "5",
    section_choices: [{ gid: "5", name: "Today" }],
  });

  expect(calls.at(-1)).toEqual({ slug: "ASANA_ADD_TASK_TO_SECTION", args: { section_gid: "5", task_gid: "42" } });
  expect(result.task.section).toBe("Today");
  expect(result.warning).toBeUndefined();
});

test("a failed section move still returns the created task, with a warning", async () => {
  const { execute } = fakeComposio({
    ...WORKSPACES,
    ASANA_CREATE_A_TASK: created(),
    ASANA_ADD_TASK_TO_SECTION: () => {
      throw new Error("section not found");
    },
  });
  const result = await createAsana(execute).createTask({ name: "Call Eric", section: "5" });

  expect(result.task.gid).toBe("42");
  expect(result.task.section).toBe("Recently assigned");
  expect(result.warning).toContain("section not found");
});

test("fields the user cleared on the card ('') are left out", async () => {
  const { execute, calls } = fakeComposio({ ...WORKSPACES, ASANA_CREATE_A_TASK: created() });
  await createAsana(execute).createTask({ name: "Call Eric", due_on: "", due_time: "", project: "", section: "" });

  expect(calls.map((c) => c.slug)).toEqual(["ASANA_GET_MULTIPLE_WORKSPACES", "ASANA_CREATE_A_TASK"]);
  expect(calls[1].args.data).toEqual({ name: "Call Eric", assignee: "me", workspace: "1" });
});

test("the workspace setting skips the lookup; otherwise the lookup runs once per process", async () => {
  const withOverride = fakeComposio({ ASANA_CREATE_A_TASK: created() });
  await createAsana(withOverride.execute, { workspaceGid: "999" }).createTask({ name: "a" });
  expect(withOverride.calls[0].args.data.workspace).toBe("999");

  const cached = fakeComposio({ ...WORKSPACES, ASANA_CREATE_A_TASK: created() });
  const asana = createAsana(cached.execute);
  await asana.createTask({ name: "a" });
  await asana.createTask({ name: "b" });
  expect(cached.calls.filter((c) => c.slug === "ASANA_GET_MULTIPLE_WORKSPACES")).toHaveLength(1);
});

test("listOptions returns projects and the sections of the user's My Tasks list", async () => {
  const { execute } = fakeComposio({
    ...WORKSPACES,
    ASANA_GET_MULTIPLE_PROJECTS: () => ({ data: [{ gid: "77", name: "Launch" }] }),
    ASANA_GET_A_USER_TASK_LIST: () => ({ data: { gid: "300" } }),
    ASANA_GET_SECTIONS_IN_PROJECT: (args) => ({ data: args.project_gid === "300" ? [{ gid: "5", name: "Today" }] : [] }),
  });

  expect(await createAsana(execute).listOptions()).toEqual({
    workspace: { gid: "1", name: "Main" },
    projects: [{ gid: "77", name: "Launch" }],
    sections: [{ gid: "5", name: "Today" }],
  });
});
