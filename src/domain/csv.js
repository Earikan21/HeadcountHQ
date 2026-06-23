/**
 * Dependency-free CSV parsing. Handles quoted fields, embedded commas/newlines,
 * and escaped double-quotes ("").
 *
 *  - parseMatrix(text)  -> string[][]  (raw rows of cells; blank lines dropped)
 *  - parseCsv(text)     -> { headers, rows }  (assumes row 0 is the header)
 *  - detectHeaderRow(m) -> index of the most likely header row
 *  - matrixToRows(m, h) -> { headers, rows } using header row index h
 *  - toCsv(cols, rows)  -> string
 */

/** Parse into an array of records (array of cell strings). Drops blank lines. */
export function parseMatrix(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const s = String(text).replace(/^﻿/, "");

  const endRecord = () => {
    record.push(field); field = "";
    const nonEmpty = record.some((c) => c.trim() !== "");
    if (nonEmpty) records.push(record);
    record = [];
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endRecord();
    } else field += c;
  }
  if (field !== "" || record.length) endRecord();
  return records;
}

/**
 * Pick the most likely header row: the first row that has at least two non-empty
 * cells (skips single-cell title rows), preferring a row whose width matches the
 * data below it. Falls back to row 0.
 */
export function detectHeaderRow(matrix) {
  if (!matrix.length) return 0;
  const nonEmptyCount = (r) => r.filter((c) => c.trim() !== "").length;
  for (let i = 0; i < matrix.length; i++) {
    if (nonEmptyCount(matrix[i]) >= 2) return i;
  }
  return 0;
}

/** Build { headers, rows } from a matrix using the given header row index. */
export function matrixToRows(matrix, headerRow = 0) {
  if (!matrix.length) return { headers: [], rows: [] };
  const hr = Math.min(Math.max(0, headerRow), matrix.length - 1);
  const headers = matrix[hr].map((h, idx) => (h.trim() || `Column ${idx + 1}`));
  const rows = [];
  for (let r = hr + 1; r < matrix.length; r++) {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = matrix[r][idx] !== undefined ? matrix[r][idx] : ""; });
    rows.push(obj);
  }
  return { headers, rows };
}

/** Convenience: parse assuming the first (auto-detected) row is the header. */
export function parseCsv(text) {
  const m = parseMatrix(text);
  return matrixToRows(m, detectHeaderRow(m));
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
