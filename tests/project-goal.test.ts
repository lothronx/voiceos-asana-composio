import { expect, test } from "bun:test";
import { createAsana, type ExecuteTool, type ProxyCall } from "../server.ts";

const iso = (daysFromToday: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PERIODS = [
  { gid: "old", display_name: "Last year", start_on: iso(-500), end_on: iso(-135) },
  { gid: "now", display_name: "This quarter", start_on: iso(-30), end_on: iso(60) },
  { gid: "next", display_name: "Next quarter", start_on: iso(61), end_on: iso(150) },
  { gid: "far", display_name: "In two years", start_on: iso(700), end_on: iso(790) },
];

/** A fake Composio with the lists the new tools read; records every call. */
function fakeAsana(answers: Record<string, (args: any) => any> = {}) {
  const calls: { slug: string; args: any }[] = [];
  const base: Record<string, (args: any) => any> = {
    ASANA_GET_MULTIPLE_WORKSPACES: () => ({ data: [{ gid: "w", name: "W" }] }),
    ASANA_GET_A_USER_TASK_LIST: () => ({ data: { gid: "ml", owner: { gid: "me1" } } }),
    ASANA_GET_MULTIPLE_PROJECTS: () => ({ data: [{ gid: "p1", name: "Launch" }] }),
    ASANA_GET_SECTIONS_IN_PROJECT: () => ({ data: [{ gid: "s1", name: "Today" }] }),
    ASANA_GET_TEAMS_IN_WORKSPACE: () => ({ data: [{ gid: "t1", name: "Marketing" }] }),
    ASANA_GET_USERS_FOR_WORKSPACE: () => ({ data: [{ gid: "me1", name: "Yue" }, { gid: "u9", name: "Sam" }] }),
    ASANA_GET_TIME_PERIODS: () => ({ data: PERIODS }),
    ...answers,
  };
  const execute: ExecuteTool = async (slug, args) => {
    calls.push({ slug, args });
    if (!base[slug]) throw new Error(`unexpected ${slug}`);
    return base[slug](args);
  };
  return { execute, calls };
}

test("task options fetch only projects and sections (no extra calls for the new kinds)", async () => {
  const fake = fakeAsana();
  const options = await createAsana(fake.execute).optionsFor("task");
  expect(Object.keys(options)).toEqual(["workspace", "projects", "sections"]);
  expect(fake.calls.map((c) => c.slug).sort()).toEqual(
    ["ASANA_GET_A_USER_TASK_LIST", "ASANA_GET_MULTIPLE_PROJECTS", "ASANA_GET_MULTIPLE_WORKSPACES", "ASANA_GET_SECTIONS_IN_PROJECT"],
  );
});

test("goal time periods: only ones that haven't ended and start within a year, in order", async () => {
  const options = await createAsana(fakeAsana().execute).optionsFor("goal");
  expect(options.time_period_choices).toEqual([{ gid: "now", name: "This quarter" }, { gid: "next", name: "Next quarter" }]);
  expect(options.owner_choices).toHaveLength(2);
});

test("a project is created with its team, view, date and description", async () => {
  const fake = fakeAsana({
    ASANA_CREATE_A_PROJECT: (args) => ({ data: { gid: "77", name: args.data.name, notes: args.data.notes, due_on: args.data.due_on, default_view: args.data.default_view, team: { name: "Marketing" }, permalink_url: "https://app.asana.com/p/77" } }),
  });
  const project = await createAsana(fake.execute).createProject({
    name: "Q4 launch", notes: " Plan it ", due_on: "2026-12-15", team: "t1", view: "board", team_choices: [{ gid: "t1", name: "Marketing" }],
  });
  expect(fake.calls.find((c) => c.slug === "ASANA_CREATE_A_PROJECT")?.args.data).toEqual({
    name: "Q4 launch", workspace: "w", notes: "Plan it", due_on: "2026-12-15", team: "t1", default_view: "board",
  });
  expect(project.details).toEqual(["Team: Marketing", "Board view"]);
});

test("a mislabeled team or an unknown view is refused before the project is created", async () => {
  const fake = fakeAsana();
  const asana = createAsana(fake.execute);
  expect(asana.createProject({ name: "x", team: "t1", team_choices: [{ gid: "t1", name: "Sales" }] })).rejects.toThrow(`The card showed team "Sales"`);
  expect(asana.createProject({ name: "x", view: "timeline" })).rejects.toThrow("There is no view timeline");
  expect(asana.createProject({ name: "x", view: "board", view_choices: [{ gid: "board", name: "List" }] })).rejects.toThrow(`The card showed view "List"`);
  // The card shows " t1"'s label; the write would go to "t1". Both must be checked.
  expect(asana.createProject({ name: "x", team: " t1", team_choices: [{ gid: "t1", name: "Marketing" }, { gid: " t1", name: "Sales" }] })).rejects.toThrow(`The card showed team "Sales"`);
  await Bun.sleep(0);
  expect(fake.calls.map((c) => c.slug)).not.toContain("ASANA_CREATE_A_PROJECT");
});

test("a goal goes through the proxy, owned by the user unless the card picked someone", async () => {
  const sent: any[] = [];
  const proxy: ProxyCall = async (toolkit, method, url, body: any) => {
    sent.push({ toolkit, method, url, body });
    return { data: { gid: "g1", name: body.data.name, due_on: body.data.due_on, owner: { name: "Yue" }, time_period: { display_name: "This quarter" } } };
  };
  const asana = createAsana(fakeAsana().execute, { proxy });
  const goal = await asana.createGoal({ name: "Ship v2", due_on: "2026-12-31", time_period: "now", time_period_choices: [{ gid: "now", name: "This quarter" }] });

  expect(sent[0].method).toBe("POST");
  expect(sent[0].url).toStartWith("https://app.asana.com/api/1.0/goals");
  expect(sent[0].body).toEqual({ data: { name: "Ship v2", workspace: "w", owner: "me1", due_on: "2026-12-31", time_period: "now" } });
  expect(goal).toMatchObject({ gid: "g1", details: ["Owner: Yue", "This quarter"], permalink_url: "" });
});

test("a mislabeled time period or an unknown owner is refused before the goal is created", async () => {
  const sent: any[] = [];
  const asana = createAsana(fakeAsana().execute, { proxy: async (...a) => { sent.push(a); return {}; } });
  expect(asana.createGoal({ name: "x", time_period: "now", time_period_choices: [{ gid: "now", name: "Next quarter" }] })).rejects.toThrow(`The card showed time period "Next quarter"`);
  expect(asana.createGoal({ name: "x", owner: "u404" })).rejects.toThrow("There is no owner u404");
  await Bun.sleep(0);
  expect(sent).toEqual([]);
});
