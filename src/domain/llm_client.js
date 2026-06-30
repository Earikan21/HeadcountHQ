/**
 * Redaction layer + LLM client — the ONLY code that may construct a prompt for
 * an external model, and the only code that performs the network call.
 *
 * The privacy promise of the AI-import feature lives here. Two mechanisms:
 *
 *  1. `RedactedPrompt` is a typed token that can only be built by the prompt
 *     builders in this file. Each builder accepts ONLY privacy-safe inputs
 *     (column headers, type/stat profiles, distinct department names, distinct
 *     job titles) and validates that those inputs are plain strings/descriptors.
 *     Salary values, employee names, and raw rows are never accepted.
 *
 *  2. `LlmClient.complete` refuses anything that is not a `RedactedPrompt`.
 *     So no route can hand the network client a free-form string built from
 *     row data — the type system + a runtime check enforce the single path.
 *
 * Providers: `anthropic` (Messages API), and the OpenAI-compatible family
 * `openai` and `gemini` (Google's free-tier endpoint). A base-URL override lets
 * any other OpenAI-compatible host (Groq, OpenRouter, …) be used with
 * provider=openai.
 *
 * See tests/redaction.test.js for the full-roster leak test that proves no comp
 * value or employee name can reach the outbound payload.
 */

const KIND = Object.freeze({ MAPPING: "mapping", CLASSIFY: "classify", TITLES: "titles" });

/** A prompt that has passed the redaction builders. Constructible only here. */
export class RedactedPrompt {
  constructor(token, kind, system, user) {
    if (token !== BUILD_TOKEN) {
      throw new Error("RedactedPrompt cannot be constructed directly — use a prompt builder.");
    }
    this.kind = kind;
    this.system = system;
    this.user = user;
    Object.freeze(this);
  }
}
const BUILD_TOKEN = Symbol("redacted-prompt");

// ---- input guards -------------------------------------------------------

function assertStringArray(arr, label) {
  if (!Array.isArray(arr)) throw new TypeError(`${label} must be an array of strings`);
  for (const v of arr) {
    if (typeof v !== "string") throw new TypeError(`${label} must contain only strings`);
  }
}

const PROFILE_KEYS = new Set(["header", "kind", "fillRate", "distinctRatio"]);
const PROFILE_KINDS = new Set(["number", "date", "text", "empty"]);

/** Profiles may only carry the four whitelisted, non-sensitive descriptor keys. */
function assertProfiles(profiles) {
  if (!Array.isArray(profiles)) throw new TypeError("profiles must be an array");
  for (const p of profiles) {
    if (!p || typeof p !== "object") throw new TypeError("each profile must be an object");
    for (const k of Object.keys(p)) {
      if (!PROFILE_KEYS.has(k)) throw new TypeError(`profile has forbidden key "${k}"`);
    }
    if (typeof p.header !== "string") throw new TypeError("profile.header must be a string");
    if (!PROFILE_KINDS.has(p.kind)) throw new TypeError("profile.kind invalid");
    if (typeof p.fillRate !== "number" || typeof p.distinctRatio !== "number") {
      throw new TypeError("profile stats must be numbers");
    }
  }
}

// ---- prompt builders ----------------------------------------------------

/** Mapping suggestion: headers + safe profiles + the target schema keys. */
export function buildMappingPrompt({ headers, profiles, schema }) {
  assertStringArray(headers, "headers");
  assertProfiles(profiles);
  if (!Array.isArray(schema)) throw new TypeError("schema must be an array");
  for (const f of schema) {
    if (typeof f.key !== "string" || typeof f.label !== "string") {
      throw new TypeError("schema entries need string key + label");
    }
  }
  const fieldLines = schema
    .map((f) => `- ${f.key}: ${f.label}${f.required ? " (required)" : ""}`)
    .join("\n");
  const colLines = profiles
    .map((p) => `- "${p.header}" — ${p.kind}, filled ${Math.round(p.fillRate * 100)}%, distinct ${Math.round(p.distinctRatio * 100)}%`)
    .join("\n");
  const system =
    "You map spreadsheet columns to a fixed set of roster fields. You are given " +
    "ONLY column headers and coarse type statistics — never any cell values. " +
    "Reply with a single JSON object mapping each field key to the EXACT header " +
    "string that best fits, or null if none fits. Use each header at most once. " +
    "No prose, JSON only.";
  const user =
    `Target fields:\n${fieldLines}\n\nSource columns:\n${colLines}\n\n` +
    `Return JSON like {"employee_id":"EmpID","name":"Full Name",...}.`;
  return new RedactedPrompt(BUILD_TOKEN, KIND.MAPPING, system, user);
}

/** Department classification: distinct department names + the category set. */
export function buildClassifyPrompt({ departmentNames, categories }) {
  assertStringArray(departmentNames, "departmentNames");
  if (!Array.isArray(categories)) throw new TypeError("categories must be an array");
  const catLines = categories.map(([k, label]) => `- ${k}: ${label}`).join("\n");
  const system =
    "You classify department names into one function category each. You are given " +
    "ONLY a list of department names — no other data. Reply with a single JSON " +
    "object mapping each department name to one category key. JSON only, no prose.";
  const user =
    `Categories:\n${catLines}\n\nDepartments:\n` +
    departmentNames.map((d) => `- ${d}`).join("\n") +
    `\n\nReturn JSON like {"Engineering":"rnd","Sales":"sm"}.`;
  return new RedactedPrompt(BUILD_TOKEN, KIND.CLASSIFY, system, user);
}

/** Title normalization: distinct job-title strings. */
export function buildTitlePrompt({ jobTitles }) {
  assertStringArray(jobTitles, "jobTitles");
  const system =
    "You normalize messy job titles into clean, standard forms (expand obvious " +
    "abbreviations, fix casing, keep meaning). You are given ONLY a list of title " +
    "strings. Reply with a single JSON object mapping each ORIGINAL title to its " +
    "cleaned form. Only include titles you actually changed. JSON only, no prose.";
  const user =
    `Titles:\n` + jobTitles.map((t) => `- ${t}`).join("\n") +
    `\n\nReturn JSON like {"sr swe":"Senior Software Engineer"}.`;
  return new RedactedPrompt(BUILD_TOKEN, KIND.TITLES, system, user);
}

// ---- tolerant JSON parse ------------------------------------------------

/** Extract the first balanced JSON object from a model reply. Throws if none. */
export function parseJsonObject(text) {
  if (typeof text !== "string") throw new TypeError("expected string");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found");
  const obj = JSON.parse(text.slice(start, end + 1));
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not a JSON object");
  return obj;
}

// ---- network client -----------------------------------------------------

/** Default full endpoints per provider. */
const ENDPOINTS = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
};
/** Providers that speak the OpenAI Chat Completions request/response shape. */
const OPENAI_FORMAT = new Set(["openai", "gemini"]);

export class LlmClient {
  /**
   * @param {object} o
   * @param {"anthropic"|"openai"|"gemini"} o.provider
   * @param {string} o.apiKey
   * @param {string} o.model
   * @param {string} [o.baseUrl]   override base URL for OpenAI-compatible hosts (no /chat/completions)
   * @param {function} [o.fetchImpl]  injectable for tests (defaults to global fetch)
   * @param {number} [o.timeoutMs]
   */
  constructor({ provider, apiKey, model, baseUrl, fetchImpl, timeoutMs = 15000 }) {
    this.provider = provider;
    this.apiKey = apiKey || "";
    this.model = model;
    this.baseUrl = (baseUrl || "").trim();
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  /** The resolved endpoint URL for this provider (or null if unknown). */
  endpoint() {
    if (this.provider === "anthropic") return ENDPOINTS.anthropic;
    if (OPENAI_FORMAT.has(this.provider)) {
      if (this.baseUrl) return this.baseUrl.replace(/\/+$/, "") + "/chat/completions";
      return ENDPOINTS[this.provider];
    }
    return null;
  }

  get configured() {
    return Boolean(this.apiKey) && Boolean(this.endpoint());
  }

  /** Send a RedactedPrompt; resolve to the model's raw text reply. */
  async complete(prompt) {
    if (!(prompt instanceof RedactedPrompt)) {
      throw new TypeError("LlmClient.complete requires a RedactedPrompt (refusing raw input).");
    }
    if (!this.configured) throw new Error("LLM client is not configured.");
    const url = this.endpoint();
    const { headers, body } = this._request(prompt);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res || !res.ok) {
      const status = res ? res.status : "no-response";
      // Include the provider's own error message (not our payload) to aid diagnosis.
      let detail = "";
      try { if (res && res.text) detail = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 240); } catch { /* ignore */ }
      throw new Error(`LLM request failed (${status})${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    return this._extractText(data);
  }

  _request(prompt) {
    if (this.provider === "anthropic") {
      return {
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: {
          model: this.model,
          max_tokens: 1024,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        },
      };
    }
    // OpenAI-compatible (openai, gemini, or any base-URL override)
    return {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: {
        model: this.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      },
    };
  }

  _extractText(data) {
    if (this.provider === "anthropic") {
      const part = data && Array.isArray(data.content) ? data.content.find((c) => c.type === "text") : null;
      if (!part || typeof part.text !== "string") throw new Error("unexpected Anthropic response shape");
      return part.text;
    }
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg || typeof msg.content !== "string") throw new Error("unexpected OpenAI-compatible response shape");
    return msg.content;
  }
}

export { KIND };
