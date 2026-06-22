/**
 * Shared server-side view helpers: the page layout with role-aware navigation,
 * a CSRF hidden field, flash banners, and small formatting utilities. All HTML
 * goes through the auto-escaping `html` tag from ../html.js.
 */
import { html, raw, esc } from "../html.js";
import { ROLE_LABELS } from "../authz.js";

/** A hidden CSRF input bound to the request's double-submit token. */
export function csrfField(ctx) {
  return raw(`<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">`);
}

export const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
export const moneyRange = (a, b) =>
  a == null && b == null ? "—" : `${money(a)} – ${money(b)}`;

/** Build the nav links appropriate to the current user. */
function navFor(user, active) {
  if (!user) return "";
  const item = (href, label, key) =>
    `<a href="${href}" class="${active === key ? "on" : ""}">${esc(label)}</a>`;
  const links = [item("/", "Dashboard", "dashboard")];
  links.push(item("/roster", "Roster", "roster"));
  links.push(item("/requests", "Requests", "requests"));
  if (user.role !== "manager") links.push(item("/planning", "Planning", "planning"));
  if (user.role === "finance_admin") {
    links.push(item("/accounts", "Accounts", "accounts"));
    links.push(item("/audit", "Audit", "audit"));
  }
  return links.join("");
}

/** Render a full page. `body` must be trusted HTML (built with `html`). */
export function renderPage(ctx, { title, body, active = "", flash = "" }) {
  const user = ctx.user;
  const flashMsg = flash || ctx.query.get("msg") || "";
  const userbox = user
    ? html`<div class="userbox">
        <span class="uname">${user.name}</span>
        <span class="urole">${ROLE_LABELS[user.role] || user.role}</span>
        <a class="signout" href="/account">Settings</a>
        <form method="post" action="/logout" class="inline">${csrfField(ctx)}<button class="linklike" type="submit">Sign out</button></form>
      </div>`
    : "";

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
    <nav class="topnav">${raw(navFor(user, active))}</nav>
    ${userbox}
  </header>
  <main class="wrap">
    ${flashMsg ? html`<div class="flash">${flashMsg}</div>` : ""}
    ${raw(body)}
  </main>
</body>
</html>`;
}

/** A standalone (no-nav) page for login / setup / invite screens. */
export function renderAuthPage(ctx, { title, body }) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} · Headcount HQ</title>
  <link rel="stylesheet" href="/static/app.css">
</head>
<body class="auth">
  <main class="authwrap">
    <div class="brand center"><span class="logo">H</span> Headcount HQ</div>
    ${raw(body)}
  </main>
</body>
</html>`;
}

export function errorList(errors) {
  if (!errors || !errors.length) return "";
  return html`<div class="errors"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}
