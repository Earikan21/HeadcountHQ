/**
 * AI-import orchestration — the async layer routes call. It ties the pure
 * helpers (import_ai.js) to the redaction layer + network client
 * (llm_client.js), and ALWAYS degrades gracefully: any AI failure (no key,
 * timeout, bad JSON, network error) falls back to the deterministic result, so
 * an import never blocks on the model.
 *
 * Failures are logged to the server console (never to the user, never with
 * payload) so an admin can diagnose why the AI was unavailable from the host
 * logs. Each function returns `{ ..., source: "ai" | "heuristic" | "local" }`.
 */
import { SCHEMA } from "./roster.js";
import { FUNCTION_CATEGORIES } from "../data/benchmarks.js";
import {
  columnProfiles, coerceMapping, heuristicMapping,
  keywordDeptCategories, coerceCategoryMap,
  normalizeTitlesLocal, coerceTitleMap,
} from "./import_ai.js";
import {
  LlmClient, buildMappingPrompt, buildClassifyPrompt, buildTitlePrompt, parseJsonObject,
} from "./llm_client.js";

/** Log an AI failure to the server console (diagnostic only; no payload). */
function logAiFailure(stage, client, err) {
  const where = client ? `${client.provider} ${client.model}` : "no-client";
  console.error(`[ai-import] ${stage} fell back (${where}): ${err && err.message ? err.message : err}`);
}

/** Build an LlmClient from runtime config, or null when not configured. */
export function clientFromConfig(config, fetchImpl) {
  if (!config || !config.aiImportConfigured) return null;
  return new LlmClient({
    provider: config.AI_IMPORT_PROVIDER,
    apiKey: config.AI_IMPORT_API_KEY,
    model: config.AI_IMPORT_MODEL,
    baseUrl: config.AI_IMPORT_BASE_URL,
    fetchImpl,
  });
}

/**
 * Suggest a column mapping. With a configured client, asks the model using ONLY
 * headers + safe profiles; otherwise (or on any failure) returns the heuristic.
 * @returns {Promise<{mapping:object, confidence:object, source:string}>}
 */
export async function suggestMapping({ headers, rows, client }) {
  const fallback = () => heuristicMapping(headers);
  if (!client || !client.configured) return fallback();
  try {
    const profiles = columnProfiles(headers, rows);
    const prompt = buildMappingPrompt({ headers, profiles, schema: SCHEMA });
    const text = await client.complete(prompt);
    const mapping = coerceMapping(parseJsonObject(text), headers);
    // Confidence: anything the AI mapped is "ai"; unmapped stays "none".
    const confidence = {};
    for (const f of SCHEMA) confidence[f.key] = mapping[f.key] ? "ai" : "none";
    return { mapping, confidence, source: "ai" };
  } catch (e) {
    logAiFailure("mapping", client, e);
    return fallback();
  }
}

/**
 * Classify departments into function categories.
 * @returns {Promise<{map:object, source:string}>}
 */
export async function classifyDepartments({ names, client }) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return { map: {}, source: "local" };
  if (!client || !client.configured) return { map: keywordDeptCategories(list), source: "heuristic" };
  try {
    const prompt = buildClassifyPrompt({ departmentNames: list, categories: FUNCTION_CATEGORIES });
    const text = await client.complete(prompt);
    const map = coerceCategoryMap(parseJsonObject(text), list);
    // fill any the model skipped with the deterministic guess
    const filled = { ...keywordDeptCategories(list), ...map };
    return { map: filled, source: "ai" };
  } catch (e) {
    logAiFailure("classify", client, e);
    return { map: keywordDeptCategories(list), source: "heuristic" };
  }
}

/**
 * Normalize messy job titles.
 * @returns {Promise<{map:object, source:string}>}
 */
export async function normalizeTitles({ titles, client }) {
  const list = (titles || []).filter(Boolean);
  if (!list.length) return { map: {}, source: "local" };
  if (!client || !client.configured) return { map: normalizeTitlesLocal(list), source: "local" };
  try {
    const prompt = buildTitlePrompt({ jobTitles: list });
    const text = await client.complete(prompt);
    const map = coerceTitleMap(parseJsonObject(text), list);
    return { map, source: "ai" };
  } catch (e) {
    logAiFailure("titles", client, e);
    return { map: normalizeTitlesLocal(list), source: "local" };
  }
}
