import { expect, test } from "bun:test";
import { createAsana, type ExecuteTool } from "../server.ts";

/** A fake Composio holding one task; records every call. */
function fakeAsana(task: Record<string, any> = {}) {
  const calls: { slug: string; args: any }[] = [];
  const state: any = { gid: "42", name: "Call Eric", completed: false, permalink_url: "https://app.asana.com/x", ...task };
  const execute: ExecuteTool = async (slug, args) => {
    calls.push({ slug, args });
    if (slug === "ASANA_GET_A_TASK") return { data: { ...state } };
    if (slug === "ASANA_UPDATE_A_TASK") { Object.assign(state, args.data); return { data: {} }; }
    // The real tool returns the story itself (no data wrapper).
    if (slug === "ASANA_CREATE_TASK_COMMENT") return { gid: "s1", text: args.text, created_by: { name: "Yue" }, created_at: "2026-10-30T16:03:33Z" };
    throw new Error(`unexpected ${slug}`);
  };
  const writes = () => calls.filter((c) => c.slug !== "ASANA_GET_A_TASK");
  return { execute, calls, writes, state };
}

test("a comment is posted as plain text on the task and echoed back", async () => {
  const fake = fakeAsana();
  const result = await createAsana(fake.execute).addComment({ task_gid: "42", task_name: "call eric", text: "  Bring the Q4 numbers. " });
  expect(fake.writes()).toEqual([{ slug: "ASANA_CREATE_TASK_COMMENT", args: { task_id: "42", text: "Bring the Q4 numbers." } }]);
  expect(result.comment).toEqual({ author: "Yue", text: "Bring the Q4 numbers.", created_at: "2026-10-30T16:03:33Z" });
  expect(result.task.name).toBe("Call Eric");
});

test("an empty comment is refused before anything is read or written", async () => {
  const fake = fakeAsana();
  expect(createAsana(fake.execute).addComment({ task_gid: "42", text: "   " })).rejects.toThrow("The comment is empty");
  expect(fake.calls).toEqual([]);
});

test("a card that named a different task is refused before any write", async () => {
  const fake = fakeAsana();
  const asana = createAsana(fake.execute);
  expect(asana.addComment({ task_gid: "42", task_name: "Pay rent", text: "hi" })).rejects.toThrow(`The card showed task "Pay rent", but that task is "Call Eric".`);
  expect(asana.setCompleted({ task_gid: "42", task_name: "Pay rent" })).rejects.toThrow("Nothing was changed");
  await Bun.sleep(0);
  expect(fake.writes()).toEqual([]);
});

test("completing sets completed: true; reopening sets false; the wanted state already there writes nothing", async () => {
  const fake = fakeAsana();
  const asana = createAsana(fake.execute);
  const done = await asana.setCompleted({ task_gid: "42", task_name: "Call Eric" });
  expect(done).toMatchObject({ changed: true, task: { completed: true } });
  expect(fake.writes()).toEqual([{ slug: "ASANA_UPDATE_A_TASK", args: { task_gid: "42", data: { completed: true } } }]);

  expect((await asana.setCompleted({ task_gid: "42", task_name: "Call Eric" })).changed).toBe(false);
  expect(fake.writes()).toHaveLength(1);

  const reopened = await asana.setCompleted({ task_gid: "42", task_name: "Call Eric", completed: false });
  expect(reopened).toMatchObject({ changed: true, task: { completed: false } });
});

test("a card without a task name is refused (fail closed) before any write", async () => {
  const fake = fakeAsana();
  const asana = createAsana(fake.execute);
  expect(asana.setCompleted({ task_gid: "42", task_name: "  " })).rejects.toThrow("didn't say which task");
  expect(asana.addComment({ task_gid: "42", text: "hi" })).rejects.toThrow("didn't say which task");
  await Bun.sleep(0);
  expect(fake.writes()).toEqual([]);
});

test("card tokens bind a task: right gid passes, another gid or a guess fails", async () => {
  const { cardToken, isCardToken } = await import("../server.ts");
  const token = cardToken("42");
  expect(isCardToken("42", token)).toBe(true);
  expect(isCardToken("43", token)).toBe(false);
  expect(isCardToken("42", "")).toBe(false);
  expect(isCardToken("42", undefined)).toBe(false);
});

test("the card path completes with a single update call that returns the task (no read first)", async () => {
  const calls: string[] = [];
  const execute: ExecuteTool = async (slug, args) => {
    calls.push(slug);
    if (slug !== "ASANA_UPDATE_A_TASK") throw new Error(`unexpected ${slug}`);
    expect(args.data).toEqual({ completed: true });
    return { data: { gid: "42", name: "Call Eric", completed: true, permalink_url: "https://app.asana.com/x" } };
  };
  const result = await createAsana(execute).completeFromCard("42", true);
  expect(calls).toEqual(["ASANA_UPDATE_A_TASK"]);
  expect(result.task).toMatchObject({ gid: "42", name: "Call Eric", completed: true });
});
