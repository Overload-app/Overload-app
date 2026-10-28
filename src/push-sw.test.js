// The phone-side code that shows a reminder (public/push-sw.js). Real
// report: reminders "only happen sometimes." Two arrive at 7am (weigh-in and
// food); if a phone ignores the tag when asked for the old notifications,
// the second must not close the first.
import { test, expect } from "vitest";
import fs from "node:fs";

function loadWorker(existing) {
  const listeners = {};
  const shown = [...existing];
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: {
      getNotifications: async () => shown.filter((n) => !n.closed), // ignores the tag, like some phones
      showNotification: async (title, opts) => { shown.push({ title, tag: opts.tag, close() { this.closed = true; } }); },
    },
    clients: { matchAll: async () => [], openWindow: async () => {} },
  };
  new Function("self", fs.readFileSync(new URL("../public/push-sw.js", import.meta.url), "utf8"))(self);
  return { push: async (data) => { let p; listeners.push({ data: { json: () => data }, waitUntil: (x) => { p = x; } }); await p; }, shown };
}

test("a food reminder doesn't remove the weigh-in reminder that came at the same time", async () => {
  const w = loadWorker([]);
  await w.push({ title: "Weigh-in time", tag: "weighin" });
  await w.push({ title: "Log your food", tag: "food" });
  expect(w.shown.filter((n) => !n.closed).map((n) => n.tag.split(":")[0])).toEqual(["weighin", "food"]);
});

test("a new rest alert still replaces the last one", async () => {
  const w = loadWorker([]);
  await w.push({ title: "Rest's up", tag: "rest" });
  await w.push({ title: "Rest's up", tag: "rest" });
  expect(w.shown.filter((n) => !n.closed)).toHaveLength(1);
});

// Real report: "rest notifications only sometimes buzz, although they show up
// on the home screen." One that replaces another with the same tag shows up
// silently on iPhone, so every notification gets a tag of its own.
test("every notification is new to the phone, so it buzzes", async () => {
  const w = loadWorker([]);
  await w.push({ title: "Rest's up", tag: "rest" });
  await new Promise((r) => setTimeout(r, 2));
  await w.push({ title: "Rest's up", tag: "rest" });
  const tags = w.shown.map((n) => n.tag);
  expect(new Set(tags).size).toBe(2);
  expect(tags.every((t) => t.startsWith("rest:"))).toBe(true);
});

test("yesterday's food reminder is cleared, not quietly updated", async () => {
  const old = { tag: "food", close() { this.closed = true; } };
  const w = loadWorker([old]);
  await w.push({ title: "Log your food", tag: "food" });
  expect(old.closed).toBe(true);
  expect(w.shown.filter((n) => !n.closed)).toHaveLength(1);
});
