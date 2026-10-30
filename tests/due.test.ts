process.env.TZ = "America/Chicago";
import { expect, test } from "bun:test";
import { dueFields } from "../server.ts";

test("date only stays a date", () => {
  expect(dueFields("2026-10-31")).toEqual({ due_on: "2026-10-31" });
});

test("date + time becomes the UTC instant of that local time", () => {
  expect(dueFields("2026-10-31", "09:00")).toEqual({ due_at: "2026-10-31T14:00:00.000Z" });
});

test("a one-digit hour from the model is padded, not rejected", () => {
  expect(dueFields("2026-10-31", "9:00")).toEqual({ due_at: "2026-10-31T14:00:00.000Z" });
});

test("impossible date with a time is rejected, not rolled forward", () => {
  expect(() => dueFields("2026-11-31", "09:00")).toThrow();
  expect(() => dueFields("2026-10-31", "24:00")).toThrow();
});

test("time without a date means no due date", () => {
  expect(dueFields("", "09:00")).toEqual({});
});
