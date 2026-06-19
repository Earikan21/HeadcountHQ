/**
 * Minimal server-side HTML rendering. `esc` escapes interpolated values to
 * prevent XSS; `html` is a tagged template that escapes every ${value} unless
 * it is wrapped with `raw(...)`. Routes never build HTML by hand without this.
 */

/** Mark a trusted HTML string so `html` won't escape it. */
export function raw(value) {
  return { __raw: String(value) };
}

/** Escape a value for safe insertion into HTML text/attributes. */
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Tagged template: escapes interpolations; arrays are joined; raw() passes through. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return out;
}

function renderValue(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(renderValue).join("");
  if (typeof v === "object" && "__raw" in v) return v.__raw;
  return esc(v);
}

/** Wrap page body content in the site layout. `body` must be trusted HTML. */
export function layout({ title, body, nav = "" }) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} · Headcount HQ</title>
  <link rel="stylesheet" href="/static/app.css">
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="logo">H</span> Headcount HQ</div>
    <nav class="topnav">${raw(nav)}</nav>
  </header>
  <main class="wrap">${raw(body)}</main>
</body>
</html>`;
}
