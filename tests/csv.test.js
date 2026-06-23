import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "../src/domain/csv.js";

test("parses simple CSV into objects", () => {
  const { headers, rows } = parseCsv("a,b\n1,2\n3,4");
  assert.deepEqual(headers, ["a", "b"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { a: "1", b: "2" });
});

test("handles quoted fields with commas and quotes", () => {
  const { rows } = parseCsv('name,note\n"Doe, Jane","She said ""hi"""');
  assert.equal(rows[0].name, "Doe, Jane");
  assert.equal(rows[0].note, 'She said "hi"');
});

test("handles embedded newlines and CRLF and BOM", () => {
  const { rows } = parseCsv('﻿a,b\r\n"line1\nline2",x\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].a, "line1\nline2");
  assert.equal(rows[0].b, "x");
});

test("skips blank lines", () => {
  const { rows } = parseCsv("a\n1\n\n2\n");
  assert.deepEqual(rows.map((r) => r.a), ["1", "2"]);
});

test("toCsv round-trips with escaping", () => {
  const out = toCsv(["a", "b"], [{ a: "x,y", b: 'q"z' }]);
  assert.equal(out, 'a,b\n"x,y","q""z"');
});
