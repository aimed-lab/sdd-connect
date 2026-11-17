// Run with `npm test`. The optional date, location and format on /events.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eventDetails } from "../../events.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("eventDetails: only the fields that are filled in, in order", () => {
  assert.deepEqual(eventDetails({ name: "x", href: "/x" }), []);
  assert.deepEqual(eventDetails({ name: "x", href: "/x", date: "  ", location: "" }), []);
  assert.deepEqual(eventDetails({ name: "x", href: "/x", format: "Hybrid", date: " 1 May 2026 " }), [
    { label: "Date", value: "1 May 2026" },
    { label: "Format", value: "Hybrid" },
  ]);
  assert.deepEqual(
    eventDetails({ name: "x", href: "/x", date: "d", location: "l", format: "Online" }).map((d) => d.label),
    ["Date", "Location", "Format"],
  );
});

test("the /events cards render the details when present", () => {
  const page = read("app/events/page.tsx");
  assert.match(page, /eventDetails\(e\)/);
  assert.match(page, /<dt[^>]*>\{d\.label\}<\/dt>/);
  assert.match(page, /<dd[^>]*>\{d\.value\}<\/dd>/);
});
