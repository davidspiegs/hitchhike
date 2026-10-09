/**
 * Workers are LLMs. They forget JSON, wrap things in prose, and retry. So the
 * relay accepts plain markdown and pulls the envelope out of it, and it only
 * pushes back when something the requester asked for is actually missing.
 */
import type { ArtifactRef, OutputSpec, ResultSubmission, Source } from "./types";
import { isHttpsUrl, truncate } from "./util";

const ENVELOPE_KEYS = new Set([
  "status", "summary", "body", "data", "sources", "artifacts", "question", "error", "confidence", "result",
]);
const STATUSES = new Set(["completed", "failed", "needs_input"]);

export interface Parsed {
  submission: ResultSubmission;
  notes: string[]; // parse problems worth telling the worker about
}

export function parseSubmission(contentType: string, raw: string, maxSummary = 1200): Parsed {
  const text = raw.trim();
  if (contentType.toLowerCase().includes("json") || text.startsWith("{")) {
    const value = tryJSON(text);
    if (value !== undefined) {
      if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length === 1 && typeof value.result === "string") return parseText(value.result, maxSummary);
        if (keys.some((k) => ENVELOPE_KEYS.has(k))) return fromObject(value, maxSummary);
      }
      return { submission: { status: "completed", data: value }, notes: [] };
    }
  }
  return parseText(text, maxSummary);
}

function fromObject(o: Record<string, unknown>, maxSummary: number): Parsed {
  const body = str(o.body) || (typeof o.result === "string" ? o.result : "");
  let summary = str(o.summary);
  let sources = normalizeSources(o.sources);
  let data = o.data;
  const notes: string[] = [];
  if (body) {
    const inner = parseText(body, maxSummary);
    if (!summary) summary = inner.submission.summary ?? "";
    if (!sources.length) sources = inner.submission.sources ?? [];
    if (data === undefined) data = inner.submission.data;
    notes.push(...inner.notes);
  }
  const status = STATUSES.has(o.status as string)
    ? (o.status as ResultSubmission["status"])
    : o.question
      ? "needs_input"
      : o.error && !summary
        ? "failed"
        : "completed";
  return {
    submission: {
      status,
      summary: summary ? truncate(summary, maxSummary) : str(o.error) || str(o.question),
      body: body || undefined,
      data,
      sources,
      artifacts: normalizeArtifacts(o.artifacts),
      question: str(o.question) || undefined,
      error: str(o.error) || undefined,
      confidence: ["low", "medium", "high"].includes(o.confidence as string)
        ? (o.confidence as ResultSubmission["confidence"])
        : undefined,
    },
    notes,
  };
}

function parseText(text: string, maxSummary: number): Parsed {
  const failed = text.match(/^FAILED\s*:\s*([\s\S]*)$/i);
  if (failed) {
    const reason = failed[1].trim() || "No reason given.";
    return { submission: { status: "failed", error: reason, summary: truncate(reason, maxSummary) }, notes: [] };
  }
  const needsInput = text.match(/^NEEDS[\s_-]?INPUT\s*:\s*([\s\S]*)$/i);
  if (needsInput) {
    const question = needsInput[1].trim();
    return { submission: { status: "needs_input", question, summary: truncate(question, maxSummary) }, notes: [] };
  }

  const sections = splitSections(text);
  const summarySection = sections.find((s) => s.heading && /^(summary|tl;?dr|answer|bottom line)\b/i.test(s.heading));
  const sourcesSection = sections.find((s) => s.heading && /^(sources|references|citations|links)\b/i.test(s.heading));
  // The summary is the prose before any code block: workers put the ```json right after it.
  const summary = beforeFence(summarySection?.content ?? "") || firstParagraph(text);

  const notes: string[] = [];
  let data: unknown;
  // Search each delimiter once. Repeated, unterminated openers must not cause
  // a regex to rescan the rest of the submission for every possible opener.
  const opener = text.toLowerCase().indexOf("```json");
  const blockStart = opener < 0 ? -1 : text.indexOf("\n", opener + 7);
  const blockEnd = blockStart < 0 ? -1 : text.indexOf("```", blockStart + 1);
  if (blockEnd >= 0) {
    try {
      data = JSON.parse(text.slice(blockStart + 1, blockEnd));
    } catch (e) {
      notes.push(`The json code block isn't valid JSON (${(e as Error).message}).`);
    }
  }
  return {
    submission: {
      status: "completed",
      summary: truncate(summary, maxSummary),
      body: text,
      data,
      sources: extractSources(sourcesSection ? sourcesSection.content : text),
    },
    notes,
  };
}

/** Problems that make a result not what the requester asked for. Empty means accept. */
export function validateSubmission(sub: ResultSubmission, output: OutputSpec | undefined, notes: string[]): string[] {
  if (sub.data !== undefined) {
    const problem = structuredDataError(sub.data);
    if (problem) return [`data (root): ${problem}; structured data cannot be accepted.`];
  }
  if (sub.status === "failed" || sub.status === "needs_input") return [];
  const errors: string[] = [];
  if (!sub.summary?.trim()) errors.push("Start with a short summary (a `## Summary` section).");
  if (output?.format === "json") {
    if (sub.data === undefined) {
      errors.push(notes.find((n) => n.includes("json code block")) ?? "Put your structured data in a ```json code block.");
    } else if (output.schema) {
      errors.push(...schemaErrors(output.schema, sub.data));
    }
  }
  return errors;
}

// Caller-supplied schemas are a bounded, explicitly supported subset, not
// executable regexes or a reference/combinator graph. See docs/output-schemas.md.
const SCHEMA_TYPES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);
const SIZE_KEYWORDS = new Set(["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]);
const NUMBER_KEYWORDS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);
const TEXT_ANNOTATIONS = new Set(["title", "description", "$comment"]);
const BOOLEAN_ANNOTATIONS = new Set(["readOnly", "writeOnly", "deprecated"]);
const MAX_VALIDATION_WORK = 100_000;
type SafeSchema = Record<string, any> | boolean;

/** Validate JSON shape before recursion, stringification, or schema evaluation. */
function jsonBudgetError(value: unknown, maxNodes: number, maxDepth: number, maxChars: number): string | undefined {
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let chars = 0;
  while (pending.length) {
    const { value: current, depth } = pending.pop()!;
    if (++nodes > maxNodes) return `exceeds ${maxNodes} JSON values`;
    if (depth > maxDepth) return `exceeds nesting depth ${maxDepth}`;
    if (typeof current === "string") chars += current.length;
    else if (typeof current === "number") {
      if (!Number.isFinite(current)) return "contains a non-finite number";
    } else if (current !== null && typeof current === "object") {
      if (seen.has(current)) return "must be a JSON tree without cycles or shared objects";
      seen.add(current);
      const prototype = Object.getPrototypeOf(current);
      if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) return "must contain only JSON objects";
      if (Array.isArray(current) && current.length > maxNodes) return `exceeds ${maxNodes} JSON values`;
      const keys = Object.keys(current);
      if (Array.isArray(current) && current.length !== keys.length) return "must contain only dense JSON arrays";
      if (nodes + pending.length + keys.length > maxNodes) return `exceeds ${maxNodes} JSON values`;
      for (const key of keys) {
        chars += key.length;
        pending.push({ value: (current as Record<string, unknown>)[key], depth: depth + 1 });
      }
    } else if (current !== null && typeof current !== "boolean") return "contains a non-JSON value";
    if (chars > maxChars) return `exceeds ${maxChars} characters`;
  }
  return undefined;
}

/** Hard admission/display limits apply even when a job does not request a schema. */
export function structuredDataError(value: unknown, maxChars = 512 * 1024): string | undefined {
  try {
    return jsonBudgetError(value, 20_000, 64, maxChars);
  } catch {
    return "could not be checked safely; use a smaller, shallower JSON value";
  }
}

const scalar = (value: unknown): boolean => value === null || ["string", "number", "boolean"].includes(typeof value);
const fieldPath = (path: string, key: string | number): string => `${path}/${String(key).slice(0, 100).replace(/~/g, "~0").replace(/\//g, "~1")}`;

/** Admission errors are also rechecked for already-stored schemas at submission. */
export function outputSchemaErrors(schema: unknown): string[] {
  const problem = (path: string, message: string) => [`output.schema ${path}: ${message}`];
  try {
    if (!isPlainObject(schema)) return problem("(root)", "must be a JSON Schema object.");
    const budget = jsonBudgetError(schema, 4096, 48, 32 * 1024);
    if (budget) return problem("(root)", budget);
    if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > 32 * 1024) return problem("(root)", "must be at most 32 KiB.");
    const pending = [{ schema: schema as SafeSchema, path: "#", depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const { schema: current, path, depth } = pending.pop()!;
      if (++nodes > 256 || depth > 16) return problem(path, "exceeds 256 schema nodes or nesting depth 16.");
      if (typeof current === "boolean") continue;
      if (!isPlainObject(current)) return problem(path, "must be a schema object or boolean.");
      for (const [key, value] of Object.entries(current)) {
        const at = fieldPath(path, key);
        if (key === "type") {
          const types = Array.isArray(value) ? value : [value];
          if (!types.length || types.length > 7 || types.some(t => typeof t !== "string" || !SCHEMA_TYPES.has(t)) || new Set(types).size !== types.length) return problem(at, "must name a JSON type or a nonempty list of distinct JSON types.");
        } else if (key === "properties") {
          if (!isPlainObject(value) || Object.keys(value).length > 200) return problem(at, "must map at most 200 property names to schemas.");
          for (const [name, child] of Object.entries(value)) pending.push({ schema: child as SafeSchema, path: fieldPath(at, name), depth: depth + 1 });
        } else if (key === "items" || key === "additionalProperties") {
          pending.push({ schema: value as SafeSchema, path: at, depth: depth + 1 });
        } else if (key === "prefixItems") {
          if (!Array.isArray(value) || !value.length || value.length > 100) return problem(at, "must be a nonempty list of at most 100 schemas.");
          value.forEach((child, index) => pending.push({ schema: child as SafeSchema, path: fieldPath(at, index), depth: depth + 1 }));
        } else if (key === "required") {
          if (!Array.isArray(value) || value.length > 200 || value.some(v => typeof v !== "string") || new Set(value).size !== value.length) return problem(at, "must be a list of at most 200 distinct property names.");
        } else if (key === "enum") {
          if (!Array.isArray(value) || !value.length || value.length > 64 || value.some(v => !scalar(v)) || new Set(value).size !== value.length) return problem(at, "must contain 1 to 64 distinct scalar JSON values; object and array enums are unsupported.");
        } else if (key === "const") {
          if (!scalar(value)) return problem(at, "must be a scalar JSON value; object and array constants are unsupported.");
        } else if (SIZE_KEYWORDS.has(key)) {
          if (!Number.isSafeInteger(value) || (value as number) < 0) return problem(at, "must be a nonnegative safe integer.");
        } else if (NUMBER_KEYWORDS.has(key)) {
          if (typeof value !== "number" || !Number.isFinite(value)) return problem(at, "must be a finite number.");
        } else if (TEXT_ANNOTATIONS.has(key)) {
          if (typeof value !== "string") return problem(at, "must be a string.");
        } else if (BOOLEAN_ANNOTATIONS.has(key)) {
          if (typeof value !== "boolean") return problem(at, "must be a boolean.");
        } else if (key === "$schema") {
          if (value !== "https://json-schema.org/draft/2020-12/schema") return problem(at, "only the JSON Schema 2020-12 dialect is supported.");
        } else if (key === "examples") {
          if (!Array.isArray(value)) return problem(at, "must be an array.");
        } else if (key !== "default") {
          return problem(at, `unsupported keyword ${JSON.stringify(key.slice(0, 100))}. Use the supported bounded schema subset; regexes, formats, references, and combinators are not supported.`);
        }
      }
    }
    return [];
  } catch {
    return problem("(root)", "could not be checked safely; simplify the schema.");
  }
}

export function isUsableSchema(schema: unknown): boolean {
  return outputSchemaErrors(schema).length === 0;
}

export function schemaErrors(schema: Record<string, unknown>, data: unknown): string[] {
  const schemaProblems = outputSchemaErrors(schema);
  if (schemaProblems.length) return schemaProblems;
  try {
    const budget = structuredDataError(data);
    if (budget) return [`data (root): ${budget}; validation could not be completed.`];
    const errors: string[] = [];
    const pending: { schema: SafeSchema; value: unknown; path: string }[] = [{ schema, value: data, path: "" }];
    let work = 0;
    const spend = (amount = 1) => { if ((work += amount) > MAX_VALIDATION_WORK) throw new Error("validation work limit"); };
    const fail = (path: string, message: string) => { if (errors.length < 6) errors.push(`data ${path || "(root)"}: ${message}`); };
    while (pending.length && errors.length < 6) {
      spend();
      const { schema: rule, value, path } = pending.pop()!;
      if (rule === true) continue;
      if (rule === false) { fail(path, "is not allowed by the schema."); continue; }
      const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      if (rule.type !== undefined) {
        const types: string[] = Array.isArray(rule.type) ? rule.type : [rule.type];
        if (!types.some(t => t === type || t === "integer" && type === "number" && Number.isInteger(value))) {
          fail(path, `must have type ${types.join(" or ")}.`);
          continue;
        }
      }
      if (Object.hasOwn(rule, "const") && value !== rule.const) fail(path, "must match the required constant.");
      if (rule.enum) {
        spend(rule.enum.length);
        if (!rule.enum.includes(value)) fail(path, "must match one of the allowed enum values.");
      }
      if (type === "object") {
        const object = value as Record<string, unknown>;
        const keys = Object.keys(object);
        const required: string[] = rule.required ?? [];
        spend(keys.length + required.length);
        for (const key of required) if (!Object.hasOwn(object, key)) fail(path, `missing required property ${JSON.stringify(key.slice(0, 100))}.`);
        if (rule.minProperties !== undefined && keys.length < rule.minProperties) fail(path, `must have at least ${rule.minProperties} properties.`);
        if (rule.maxProperties !== undefined && keys.length > rule.maxProperties) fail(path, `must have at most ${rule.maxProperties} properties.`);
        for (const key of keys) {
          const child = rule.properties && Object.hasOwn(rule.properties, key) ? rule.properties[key] : rule.additionalProperties;
          if (child !== undefined) pending.push({ schema: child, value: object[key], path: fieldPath(path, key) });
        }
      } else if (type === "array") {
        const array = value as unknown[];
        spend(array.length);
        if (rule.minItems !== undefined && array.length < rule.minItems) fail(path, `must have at least ${rule.minItems} items.`);
        if (rule.maxItems !== undefined && array.length > rule.maxItems) fail(path, `must have at most ${rule.maxItems} items.`);
        for (let index = 0; index < array.length; index++) {
          const child = index < (rule.prefixItems?.length ?? 0) ? rule.prefixItems[index] : rule.items;
          if (child !== undefined) pending.push({ schema: child, value: array[index], path: fieldPath(path, index) });
        }
      } else if (type === "string") {
        // JSON Schema counts Unicode code points, not UTF-16 code units.
        let length = 0;
        if (rule.minLength !== undefined || rule.maxLength !== undefined) for (const _ of value as string) length++;
        if (rule.minLength !== undefined && length < rule.minLength) fail(path, `must contain at least ${rule.minLength} characters.`);
        if (rule.maxLength !== undefined && length > rule.maxLength) fail(path, `must contain at most ${rule.maxLength} characters.`);
      } else if (type === "number") {
        const number = value as number;
        if (rule.minimum !== undefined && number < rule.minimum) fail(path, `must be at least ${rule.minimum}.`);
        if (rule.maximum !== undefined && number > rule.maximum) fail(path, `must be at most ${rule.maximum}.`);
        if (rule.exclusiveMinimum !== undefined && number <= rule.exclusiveMinimum) fail(path, `must be greater than ${rule.exclusiveMinimum}.`);
        if (rule.exclusiveMaximum !== undefined && number >= rule.exclusiveMaximum) fail(path, `must be less than ${rule.exclusiveMaximum}.`);
      }
    }
    return errors;
  } catch {
    return [`data (root): validation could not be completed within the supported limits (${MAX_VALIDATION_WORK} checks); simplify the schema or reduce the data.`];
  }
}

interface Section {
  heading: string | null;
  content: string;
}

function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let content: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const nextHeading =
      hashHeading(line) ??
      line.match(/^\*\*([^*]{2,40}?)\*\*:?\s*$/)?.[1] ??
      line.match(/^(summary|tl;?dr|sources|references)\s*:\s*$/i)?.[1];
    if (nextHeading) {
      sections.push({ heading, content: content.join("\n") });
      heading = trimSuffix(nextHeading, ":*").trim();
      content = [];
    } else content.push(line);
  }
  sections.push({ heading, content: content.join("\n") });
  return sections;
}

function hashHeading(line: string): string | undefined {
  let count = 0;
  while (line[count] === "#") count++;
  if (count < 1 || count > 4 || !line[count] || !/\s/u.test(line[count])) return undefined;
  return trimSuffix(line.slice(count).trim(), "#").trim() || undefined;
}

function trimSuffix(text: string, characters: string): string {
  let end = text.length;
  while (end && characters.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

function beforeFence(text: string): string {
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    const lineEnd = end < 0 ? text.length : end;
    if (text.slice(start, lineEnd).trimStart().startsWith("```")) return text.slice(0, start).trim();
    start = lineEnd + 1;
  }
  return text.trim();
}

function firstParagraph(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("```")) {
      if (out.length) break;
      inFence = !inFence;
      continue;
    }
    if (inFence || (!out.length && (!t || t.startsWith("#")))) continue;
    if (out.length && !t) break;
    out.push(t);
  }
  return out.join(" ") || text.slice(0, 400);
}

function extractSources(text: string): Source[] {
  const seen = new Map<string, Source>();
  // The title search has a fixed bound; after a URL opener, advance through its
  // entire candidate even if the closing parenthesis is missing.
  const link = /\[([^\]]{1,200})\]\((https?:\/\/)/g;
  let match: RegExpExecArray | null;
  while (seen.size < 50 && (match = link.exec(text))) {
    const urlStart = link.lastIndex - match[2].length;
    let end = link.lastIndex;
    while (end < text.length && text[end] !== ")" && !/\s/u.test(text[end])) end++;
    if (text[end] === ")" && end > link.lastIndex) {
      const url = text.slice(urlStart, end);
      if (!seen.has(url)) seen.set(url, { url, title: match[1].trim() });
    }
    link.lastIndex = Math.max(end, link.lastIndex);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s<>()\[\]"'`]+/g)) {
    if (seen.size >= 50) break;
    const url = trimSuffix(m[0], ".,;:!?");
    if (!seen.has(url)) seen.set(url, { url });
  }
  return [...seen.values()];
}

function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const out: Source[] = [];
  for (const item of value) {
    if (typeof item === "string" && /^https?:\/\//.test(item)) out.push({ url: item });
    else if (isPlainObject(item) && typeof item.url === "string" && /^https?:\/\//.test(item.url)) {
      out.push({ url: item.url, title: str(item.title) || undefined, note: str(item.note) || undefined });
    }
  }
  return out.slice(0, 50);
}

export function normalizeArtifacts(value: unknown): ArtifactRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ArtifactRef[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || !isHttpsUrl(item.url)) continue;
    out.push({
      name: str(item.name) || item.url,
      url: item.url,
      mime: str(item.mime) || undefined,
      sha256: str(item.sha256) || undefined,
      bytes: typeof item.bytes === "number" ? item.bytes : undefined,
    });
  }
  return out.slice(0, 20);
}

function tryJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
