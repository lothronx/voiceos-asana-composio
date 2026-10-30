import { expect, test } from "bun:test";
import { friendlyDue, isOverdue } from "../server.ts";

const NOW = new Date(2026, 9, 30, 10, 0); // Fri Oct 30 2026, 10:00 local

test("near dates read the way people say them", () => {
  expect(friendlyDue("2026-10-30 14:30", NOW)).toBe("Today 2:30 PM");
  expect(friendlyDue("2026-10-31", NOW)).toBe("Tomorrow");
  expect(friendlyDue("2026-10-29 09:05", NOW)).toBe("Yesterday 9:05 AM");
  expect(friendlyDue("2026-11-03 00:00", NOW)).toBe("Tue 12:00 AM");
});

test("dates a week or more away (or further back) show month and day, plus year when not this year", () => {
  expect(friendlyDue("2026-11-06", NOW)).toBe("Nov 6");
  expect(friendlyDue("2026-10-20", NOW)).toBe("Oct 20");
  expect(friendlyDue("2027-01-02 12:15", NOW)).toBe("Jan 2, 2027 12:15 PM");
});

test("empty or unexpected input passes through", () => {
  expect(friendlyDue("", NOW)).toBe("");
  expect(friendlyDue("soon", NOW)).toBe("soon");
});

test("only open tasks due before today are overdue", () => {
  expect(isOverdue("2026-10-29 14:00", false, NOW)).toBe(true);
  expect(isOverdue("2026-10-29", true, NOW)).toBe(false);
  expect(isOverdue("2026-10-30 08:00", false, NOW)).toBe(false);
  expect(isOverdue("", false, NOW)).toBe(false);
});
