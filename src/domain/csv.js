/**
 * Dependency-free CSV parser. Handles quoted fields, embedded commas/newlines,
 * and escaped double-quotes (""). Returns { headers, rows } where each row is an
 * object keyed by header. Blank lines are skipped.
 */
export function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const s = String(text).replace(/^﻿/, ""); // strip BOM

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || record.length) {
    record.push(field);
    if (record.length > 1 || record[0] !== "") records.push(record);
  }

  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = records[r][idx] !== undefined ? records[r][idx] : ""; });
    rows.push(obj);
  }
  return { headers, rows };
}

/** Serialize array-of-objects to CSV using the given column order. */
export function toCsv(columns, rows) {
  const esc = (v) => {
    const str = v == null ? "" : String(v);
    return /[",\n\r]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str;
  };
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(","));
  return lines.join("\n");
}
