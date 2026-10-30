process.env.TZ = "America/Chicago";
import { expect, test } from "bun:test";
import { createAsana } from "../server.ts";
import type { ExecuteTool } from "../server.ts";

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
/** The real lists createTask verifies a picked project/section against. */
const LISTS = {
  ...WORKSPACES,
  ASANA_GET_A_USER_TASK_LIST: () => ({ data: { gid: "300", owner: { gid: "me1" } } }),
  ASANA_GET_MULTIPLE_PROJECTS: () => ({ data: [{ gid: "77", name: "Launch" }] }),
  ASANA_GET_SECTIONS_IN_PROJECT: () => ({ data: [{ gid: "5", name: "Today" }] }),
};
const created = (extra: object = {}) => () => ({
  data: { gid: "42", name: "Call Eric", assignee_section: { name: "Recently assigned" }, ...extra },
});

test("creates the task for me in the first workspace, with due time in UTC and the project", async () => {
  const { execute, calls } = fakeComposio({ ...LISTS, ASANA_CREATE_A_TASK: created({ due_at: "x" }) });
  await createAsana(execute).createTask({ name: "Call Eric", due_on: "2026-10-31", due_time: "9:00", project: "77" });

  expect(calls.find((c) => c.slug === "ASANA_CREATE_A_TASK")?.args).toEqual({
    data: { name: "Call Eric", assignee: "me", workspace: "1", due_at: "2026-10-31T14:00:00.000Z", projects: ["77"] },
  });
});

test("the section is set in the create call itself, and the result names it", async () => {
  const { execute, calls } = fakeComposio({
    ...LISTS,
    ASANA_CREATE_A_TASK: (args) => ({ data: { gid: "42", name: "Call Eric", assignee_section: { gid: args.data.assignee_section, name: "Today" } } }),
  });
  const result = await createAsana(execute).createTask({ name: "Call Eric", section: "5", section_choices: [{ gid: "5", name: "Today" }] });

  expect(calls.find((c) => c.slug === "ASANA_CREATE_A_TASK")?.args.data.assignee_section).toBe("5");
  expect(calls.map((c) => c.slug)).not.toContain("ASANA_ADD_TASK_TO_SECTION");
  expect(result.task.section).toBe("Today");
});

test("one options fetch serves several creates (lists are cached)", async () => {
  const { execute, calls } = fakeComposio({ ...LISTS, ASANA_CREATE_A_TASK: created() });
  const asana = createAsana(execute);
  await asana.listOptions();
  await asana.createTask({ name: "a", project: "77" });
  await asana.createTask({ name: "b", section: "5" });
  expect(calls.filter((c) => c.slug === "ASANA_GET_MULTIPLE_PROJECTS")).toHaveLength(1);
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

test("notes are sent when given and left out when blank", async () => {
  const withNotes = fakeComposio({ ...WORKSPACES, ASANA_CREATE_A_TASK: created() });
  await createAsana(withNotes.execute).createTask({ name: "Call Eric", notes: "  Bring the Q4 numbers " });
  expect(withNotes.calls.find((c) => c.slug === "ASANA_CREATE_A_TASK")?.args.data.notes).toBe("Bring the Q4 numbers");

  const blank = fakeComposio({ ...WORKSPACES, ASANA_CREATE_A_TASK: created() });
  await createAsana(blank.execute).createTask({ name: "Call Eric", notes: "  " });
  expect(blank.calls.find((c) => c.slug === "ASANA_CREATE_A_TASK")?.args.data).not.toHaveProperty("notes");
});

test("a project the card labeled wrongly is refused before the task is created", async () => {
  const { execute, calls } = fakeComposio({ ...LISTS, ASANA_CREATE_A_TASK: created() });
  const result = createAsana(execute).createTask({ name: "Call Eric", project: "77", project_choices: [{ gid: "77", name: "Personal" }] });
  expect(result).rejects.toThrow(`The card showed project "Personal", but it is "Launch".`);
  await result.catch(() => {});
  expect(calls.map((c) => c.slug)).not.toContain("ASANA_CREATE_A_TASK");
});
