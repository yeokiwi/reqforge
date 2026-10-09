// validateDocumentJson: what the server will store (RD-063). It parses the JSON with the
// shared schema, checks it, applies the value rules of `03` §1.4 and returns the canonical
// form (`03` §1.5): `node.toJSON()` of the parsed node — unknown attributes dropped, keys in
// schema order, adjacent text nodes with identical marks merged.
// spec: docs/specs/03-authoring-and-indexing.md sections 1.4 and 1.5 (RD-058, RD-063)
import { Mark, Node as PMNode } from "@tiptap/pm/model";
import {
  HEADING_LEVELS,
  INDENT_MAX,
  MAX_COLSPAN,
  MAX_COLUMN_WIDTH,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_WIDTH,
  MAX_JSON_DEPTH,
  MAX_MENTION_LABEL_LENGTH,
  MAX_NODE_DEPTH,
  MAX_ROWSPAN,
  PANEL_VARIANTS,
  STATUS_COLOURS,
  STATUS_TEXT_MAX,
  TABLE_WIDTH_MODES,
  TEXT_ALIGNMENTS,
  isAllowedHref,
  isAttachmentSrcFor,
  isCalendarDate,
  isCodeLanguage,
  isEntityId,
  isIntegerInRange,
  isOneOf,
  isOptionalHexColour,
  isStatusText,
} from "./rules";
import { documentSchema } from "./schema";
import type { DocumentJson } from "./types";

export type ValidationReason = "MALFORMED" | "TOO_LARGE" | "TOO_DEEP" | "SCHEMA" | "RULE";

export interface ValidationIssue {
  /** JSON Pointer into the input, e.g. `/content/3/content/0`; `""` is the document. */
  path: string;
  message: string;
}

export interface ValidationContext {
  /** When given, every image must reference one of these attachments (RD-058). */
  allowedAttachmentIds?: ReadonlySet<string>;
}

export type ValidationSuccess = { ok: true; doc: DocumentJson; bytes: number };
export type ValidationFailure = { ok: false; reason: ValidationReason; errors: ValidationIssue[] };
export type ValidationResult = ValidationSuccess | ValidationFailure;

export const MAX_REPORTED_ERRORS = 50;

type JsonObject = Record<string, unknown>;

function failure(reason: ValidationReason, path: string, message: string): ValidationFailure {
  return { ok: false, reason, errors: [{ path, message }] };
}

function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function pointerToken(key: string | number): string {
  return typeof key === "number" ? String(key) : key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Quotes a value for a message, never echoing more than 60 characters of it. */
function quote(value: unknown): string {
  const text = typeof value === "string" ? value : String(value);
  return JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}…` : text);
}

// ------------------------------------------------------------------------------ prescan

/** Bytes `JSON.stringify` would spend on this string, UTF-8 encoded, quotes included. */
function jsonStringBytes(s: string): number {
  let n = 2;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c) n += 2;
    else if (c < 0x20) n += c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d ? 2 : 6;
    else if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 6;
    } else if (c >= 0xdc00 && c <= 0xdfff) n += 6;
    else n += 3;
  }
  return n;
}

/**
 * Why Postgres `jsonb` would refuse this string, or null when it would store it. A JavaScript
 * string may hold U+0000 and unpaired UTF-16 surrogates (a client slicing between the two
 * halves of an emoji makes one); `JSON.stringify` writes them as `\u0000` and `\udXXX`
 * escapes, and jsonb refuses both. Content that validates must be storable (RD-063).
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.5 (RD-063)
function unstorable(s: string): string | null {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) return "Text cannot contain the character U+0000";
    if (c < 0xd800 || c > 0xdfff) continue;
    const next = s.charCodeAt(i + 1);
    if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      i++; // a well-formed pair
      continue;
    }
    return "Text cannot contain half of a character (an unpaired UTF-16 surrogate)";
  }
  return null;
}

/** UTF-8 length of a string that is already well-formed JSON text. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

type Role = "node" | "content" | "other";

interface Frame {
  value: object;
  array: boolean;
  keys: readonly string[];
  length: number;
  index: number;
  written: number;
  jsonDepth: number;
  nodeDepth: number;
  role: Role;
  /** This frame's key in its parent, for error paths; null for the root. */
  key: string | number | null;
}

function pathOf(stack: readonly Frame[], last?: string | number): string {
  const tokens = stack.filter((f) => f.key !== null).map((f) => pointerToken(f.key as string | number));
  if (last !== undefined) tokens.push(pointerToken(last));
  return tokens.length ? `/${tokens.join("/")}` : "";
}

/**
 * One iterative pass over the raw input, before any parsing: it measures what
 * `JSON.stringify(input)` would weigh, the node and JSON nesting depth, and refuses
 * anything that is not plain JSON data (functions, class instances, cycles) or that Postgres
 * jsonb cannot store (U+0000, unpaired surrogates, in any string value). It stops as soon as
 * a limit is crossed, so a hostile input costs at most ~5 MiB of scanning and never recurses.
 */
function prescan(input: JsonObject): ValidationFailure | null {
  const stack: Frame[] = [];
  const onPath = new Set<object>();
  let bytes = 0;

  const push = (value: object, key: string | number | null, jsonDepth: number, nodeDepth: number, role: Role) => {
    const array = Array.isArray(value);
    const keys = array ? [] : Object.keys(value);
    stack.push({
      value,
      array,
      keys,
      length: array ? (value as unknown[]).length : keys.length,
      index: 0,
      written: 0,
      jsonDepth,
      nodeDepth,
      role,
      key,
    });
    onPath.add(value);
    bytes += 2;
  };

  push(input, null, 1, 1, "node");

  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    if (frame.index >= frame.length) {
      stack.pop();
      onPath.delete(frame.value);
      continue;
    }
    const i = frame.index++;
    let key: string | number;
    let child: unknown;
    if (frame.array) {
      key = i;
      child = (frame.value as unknown[])[i];
      if (i > 0) bytes += 1;
    } else {
      key = frame.keys[i] as string;
      child = (frame.value as JsonObject)[key];
      if (child === undefined) continue; // JSON.stringify omits it
      if (frame.written > 0) bytes += 1;
      frame.written++;
      bytes += jsonStringBytes(key) + 1;
    }

    if (typeof child === "string") {
      if (child.length > MAX_DOCUMENT_BYTES - bytes) {
        return failure("TOO_LARGE", "", `The document is larger than ${MAX_DOCUMENT_BYTES} bytes`);
      }
      const problem = unstorable(child);
      if (problem) return failure("MALFORMED", pathOf(stack, key), problem);
      bytes += jsonStringBytes(child);
    } else if (typeof child === "number") {
      if (!Number.isFinite(child)) return failure("MALFORMED", pathOf(stack, key), "Numbers must be finite");
      bytes += String(child).length;
    } else if (typeof child === "boolean") {
      bytes += child ? 4 : 5;
    } else if (child === null) {
      bytes += 4;
    } else if (typeof child === "object") {
      if (!Array.isArray(child) && !isPlainObject(child)) {
        return failure("MALFORMED", pathOf(stack, key), "Only plain JSON objects and arrays are allowed");
      }
      if (onPath.has(child)) return failure("MALFORMED", pathOf(stack, key), "The document contains a cycle");
      const jsonDepth = frame.jsonDepth + 1;
      let nodeDepth = frame.nodeDepth;
      let role: Role = "other";
      if (frame.role === "node" && key === "content" && Array.isArray(child)) role = "content";
      else if (frame.role === "content" && !Array.isArray(child)) {
        role = "node";
        nodeDepth += 1;
      }
      if (nodeDepth > MAX_NODE_DEPTH || jsonDepth > MAX_JSON_DEPTH) {
        return failure("TOO_DEEP", pathOf(stack, key), `Nodes may be nested at most ${MAX_NODE_DEPTH} deep`);
      }
      push(child, key, jsonDepth, nodeDepth, role);
    } else {
      return failure("MALFORMED", pathOf(stack, key), `A ${typeof child} is not JSON data`);
    }

    if (bytes > MAX_DOCUMENT_BYTES) {
      return failure("TOO_LARGE", "", `The document is larger than ${MAX_DOCUMENT_BYTES} bytes`);
    }
  }
  return null;
}

// -------------------------------------------------------------------------------- shape

function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

class Issues {
  readonly list: ValidationIssue[] = [];
  private truncated = false;

  add(path: string, message: string): void {
    if (this.list.length < MAX_REPORTED_ERRORS) this.list.push({ path, message });
    else if (!this.truncated) {
      this.truncated = true;
      this.list.push({ path: "", message: `Too many errors; the first ${MAX_REPORTED_ERRORS} are listed` });
    }
  }

  get any(): boolean {
    return this.list.length > 0;
  }
}

/**
 * Structural checks with precise paths, before ProseMirror sees the input: every node and
 * mark is an object with a known `type`, `content` and `marks` are arrays, text is a
 * non-empty string. Recursion is safe: the prescan bounded the depth at 64.
 */
function checkShape(json: JsonObject, path: string, issues: Issues, root: boolean): void {
  const type = json.type;
  if (typeof type !== "string") {
    issues.add(path, 'A node needs a string "type"');
    return;
  }
  if (!has(documentSchema.nodes, type)) {
    issues.add(`${path}/type`, `Unknown node type ${quote(type)}`);
    return;
  }
  if (root !== (type === "doc")) {
    issues.add(`${path}/type`, root ? 'The top-level node must be "doc"' : '"doc" may only be the top-level node');
    return;
  }
  if (has(json, "attrs") && json.attrs !== undefined && !isPlainObject(json.attrs)) {
    issues.add(`${path}/attrs`, '"attrs" must be an object');
  }
  if (has(json, "marks") && json.marks !== undefined) {
    if (!Array.isArray(json.marks)) issues.add(`${path}/marks`, '"marks" must be an array');
    else {
      json.marks.forEach((mark: unknown, i: number) => {
        const markPath = `${path}/marks/${i}`;
        if (!isPlainObject(mark) || typeof mark.type !== "string") {
          issues.add(markPath, 'A mark must be an object with a string "type"');
        } else if (!has(documentSchema.marks, mark.type)) {
          issues.add(`${markPath}/type`, `Unknown mark type ${quote(mark.type)}`);
        } else if (has(mark, "attrs") && mark.attrs !== undefined && !isPlainObject(mark.attrs)) {
          issues.add(`${markPath}/attrs`, '"attrs" must be an object');
        }
      });
    }
  }
  if (type === "text") {
    if (typeof json.text !== "string" || json.text.length === 0) {
      issues.add(`${path}/text`, "A text node needs non-empty text");
    }
    if (has(json, "content") && json.content !== undefined) issues.add(`${path}/content`, "A text node has no content");
    return;
  }
  if (!has(json, "content") || json.content === undefined) return;
  if (!Array.isArray(json.content)) {
    issues.add(`${path}/content`, '"content" must be an array');
    return;
  }
  json.content.forEach((child: unknown, i: number) => {
    const childPath = `${path}/content/${i}`;
    if (!isPlainObject(child)) issues.add(childPath, "A node must be an object");
    else checkShape(child, childPath, issues, false);
  });
}

// ------------------------------------------------------------------- aligned tree walk

type Visit = (node: PMNode, raw: JsonObject, path: string, parent: PMNode | null) => void;

/**
 * Walks the parsed tree alongside the raw JSON, so issues carry paths into the *input*.
 * ProseMirror merges adjacent text nodes with identical marks while parsing, so one parsed
 * text node may stand for several raw ones; it is reported at the first of them.
 */
function walkAligned(node: PMNode, raw: JsonObject, path: string, visit: Visit, parent: PMNode | null = null): void {
  visit(node, raw, path, parent);
  const rawContent = Array.isArray(raw.content) ? (raw.content as JsonObject[]) : [];
  let r = 0;
  node.forEach((child) => {
    const rawChild = rawContent[r];
    if (!rawChild) return;
    walkAligned(child, rawChild, `${path}/content/${r}`, visit, node);
    if (child.isText) {
      const length = child.text?.length ?? 0;
      let consumed = 0;
      while (consumed < length && r < rawContent.length) {
        const text = rawContent[r]?.text;
        consumed += typeof text === "string" ? text.length : length;
        r++;
      }
    } else {
      r++;
    }
  });
}

function rawMarkIndex(raw: JsonObject, name: string): number {
  const marks = Array.isArray(raw.marks) ? (raw.marks as unknown[]) : [];
  const index = marks.findIndex((m) => isPlainObject(m) && m.type === name);
  return index < 0 ? 0 : index;
}

function locateStructuralIssues(doc: PMNode, raw: JsonObject, issues: Issues): void {
  walkAligned(doc, raw, "", (node, _raw, path, parent) => {
    const type = node.type;
    const match = type.contentMatch.matchFragment(node.content);
    if (!match || !match.validEnd) {
      issues.add(
        path,
        type.isLeaf
          ? `${type.name} takes no content`
          : `Invalid content for ${type.name}: expected ${type.spec.content ?? "nothing"}`,
      );
    }
    if (parent && !parent.type.allowsMarks(node.marks)) {
      const disallowed = node.marks.find((m) => !parent.type.allowsMarkType(m.type));
      issues.add(`${path}/marks`, `Mark ${quote(disallowed?.type.name ?? "?")} is not allowed in ${parent.type.name}`);
    }
    let set: readonly Mark[] = Mark.none;
    for (const mark of node.marks) set = mark.addToSet(set);
    if (!Mark.sameSet(set, node.marks)) {
      issues.add(`${path}/marks`, `These marks cannot be combined: ${node.marks.map((m) => m.type.name).join(", ")}`);
    }
  });
}

// --------------------------------------------------------------------------- value rules

type AttrRule = (value: unknown, attrs: Readonly<Record<string, unknown>>, context: ValidationContext) => string | null;

const textAlign: AttrRule = (v) =>
  v === null || isOneOf(TEXT_ALIGNMENTS, v) ? null : `textAlign must be one of ${TEXT_ALIGNMENTS.join(", ")} or null`;
const indent: AttrRule = (v) => (isIntegerInRange(v, 0, INDENT_MAX) ? null : `indent must be an integer from 0 to ${INDENT_MAX}`);
const bool =
  (name: string): AttrRule =>
  (v) =>
    typeof v === "boolean" ? null : `${name} must be true or false`;
const oneOf =
  (name: string, values: readonly string[]): AttrRule =>
  (v) =>
    isOneOf(values, v) ? null : `${name} must be one of ${values.join(", ")}`;
const optionalString =
  (name: string): AttrRule =>
  (v) =>
    v === null || typeof v === "string" ? null : `${name} must be a string or null`;
const colour =
  (name: string): AttrRule =>
  (v) =>
    isOptionalHexColour(v) ? null : `${name} must be a colour #rrggbb or null`;
const level =
  (name: string): AttrRule =>
  (v) =>
    isIntegerInRange(v, 1, 6) ? null : `${name} must be an integer from 1 to 6`;

const cellRules: Record<string, AttrRule> = {
  colspan: (v) => (isIntegerInRange(v, 1, MAX_COLSPAN) ? null : `colspan must be an integer from 1 to ${MAX_COLSPAN}`),
  rowspan: (v) => (isIntegerInRange(v, 1, MAX_ROWSPAN) ? null : `rowspan must be an integer from 1 to ${MAX_ROWSPAN}`),
  colwidth: (v, attrs) => {
    if (v === null) return null;
    const ok =
      Array.isArray(v) &&
      v.length === attrs.colspan &&
      v.every((w) => typeof w === "number" && Number.isFinite(w) && w >= 0 && w <= MAX_COLUMN_WIDTH);
    return ok ? null : `colwidth must be null or one width per spanned column, each from 0 to ${MAX_COLUMN_WIDTH}`;
  },
  background: colour("background"),
};

/**
 * One rule for every attribute of every node and mark in the schema. A unit test fails if
 * the schema gains an attribute that has no rule here, so nothing reaches storage unjudged.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-058, RD-063)
export const NODE_ATTRIBUTE_RULES: Readonly<Record<string, Readonly<Record<string, AttrRule>>>> = {
  doc: {},
  paragraph: { textAlign, indent },
  heading: {
    textAlign,
    indent,
    level: (v) => (isOneOf(HEADING_LEVELS, v) ? null : "level must be an integer from 1 to 6"),
  },
  blockquote: {},
  codeBlock: {
    language: (v) => (isCodeLanguage(v) ? null : "language must be null or one token of at most 64 characters"),
  },
  horizontalRule: {},
  bulletList: {},
  orderedList: {
    start: (v) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? null : "start must be a whole number"),
  },
  listItem: {},
  taskList: {},
  taskItem: { checked: bool("checked") },
  table: { widthMode: oneOf("widthMode", TABLE_WIDTH_MODES), numberedColumn: bool("numberedColumn") },
  tableRow: {},
  tableHeader: cellRules,
  tableCell: cellRules,
  infoPanel: { variant: oneOf("variant", PANEL_VARIANTS) },
  tableOfContents: {
    minLevel: (v, attrs) => {
      const problem = level("minLevel")(v, attrs, {});
      if (problem) return problem;
      return isIntegerInRange(attrs.maxLevel, 1, 6) && (v as number) > attrs.maxLevel ? "minLevel must not exceed maxLevel" : null;
    },
    maxLevel: level("maxLevel"),
  },
  image: {
    attachmentId: (v, _attrs, context) => {
      if (!isEntityId(v)) return "An image needs the attachmentId of an attachment of this page";
      if (context.allowedAttachmentIds && !context.allowedAttachmentIds.has(v)) {
        return `Attachment ${quote(v)} is not an attachment of this page`;
      }
      return null;
    },
    src: (v, attrs) =>
      isAttachmentSrcFor(v, attrs.attachmentId)
        ? null
        : "src must be exactly /api/v1/attachments/{attachmentId}/{filename}; external images are refused",
    alt: optionalString("alt"),
    title: optionalString("title"),
    width: (v) => (v === null || isIntegerInRange(v, 1, MAX_IMAGE_WIDTH) ? null : `width must be null or an integer from 1 to ${MAX_IMAGE_WIDTH}`),
  },
  status: {
    text: (v) => (isStatusText(v) ? null : `Status text must be 1 to ${STATUS_TEXT_MAX} characters on one line`),
    colour: oneOf("colour", STATUS_COLOURS),
  },
  date: {
    value: (v) => (isCalendarDate(v) ? null : "A date must be a real calendar date written YYYY-MM-DD"),
  },
  mention: {
    userId: (v) => (isEntityId(v) ? null : "A mention needs the userId of a user"),
    label: (v) =>
      typeof v === "string" && v.trim().length > 0 && v.length <= MAX_MENTION_LABEL_LENGTH
        ? null
        : `A mention needs a label of 1 to ${MAX_MENTION_LABEL_LENGTH} characters`,
  },
  hardBreak: {},
  text: {},
};

// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-063)
export const MARK_ATTRIBUTE_RULES: Readonly<Record<string, Readonly<Record<string, AttrRule>>>> = {
  link: {
    href: (v) =>
      isAllowedHref(v) ? null : "Link targets must use http, https, mailto or tel, or be a path starting with a single /",
  },
  textStyle: { color: colour("color") },
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  subscript: {},
  superscript: {},
};

function applyRules(
  rules: Readonly<Record<string, AttrRule>> | undefined,
  attrs: Readonly<Record<string, unknown>>,
  path: string,
  context: ValidationContext,
  issues: Issues,
): void {
  for (const name of Object.keys(attrs)) {
    const rule = rules?.[name];
    const problem = rule ? rule(attrs[name], attrs, context) : `No rule for attribute ${quote(name)}`;
    if (problem) issues.add(`${path}/attrs/${pointerToken(name)}`, problem);
  }
}

function checkRules(doc: PMNode, raw: JsonObject, context: ValidationContext, issues: Issues): void {
  walkAligned(doc, raw, "", (node, rawNode, path) => {
    applyRules(NODE_ATTRIBUTE_RULES[node.type.name], node.attrs, path, context, issues);
    for (const mark of node.marks) {
      const markPath = `${path}/marks/${rawMarkIndex(rawNode, mark.type.name)}`;
      applyRules(MARK_ATTRIBUTE_RULES[mark.type.name], mark.attrs, markPath, context, issues);
    }
  });
}

// ------------------------------------------------------------------------------- entry

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid document";
}

/**
 * Validates untrusted ProseMirror JSON and returns its canonical form. Order matters: the
 * cheap bounded prescan (shape of JSON, 5 MiB, depth 64) runs before anything that
 * allocates per node, so hostile input is refused for the price of reading it once.
 * Idempotent: validating the canonical output returns an identical output.
 */
// spec: docs/specs/03-authoring-and-indexing.md sections 1.4 and 1.5 (RD-058, RD-063)
export function validateDocumentJson(input: unknown, context: ValidationContext = {}): ValidationResult {
  if (!isPlainObject(input)) return failure("MALFORMED", "", "A document must be a JSON object");

  let pre: ValidationFailure | null;
  try {
    pre = prescan(input);
  } catch (error) {
    // Getters that throw, revoked proxies and similar: not JSON data.
    return failure("MALFORMED", "", messageOf(error));
  }
  if (pre) return pre;

  const shape = new Issues();
  checkShape(input, "", shape, true);
  if (shape.any) return { ok: false, reason: "SCHEMA", errors: shape.list };

  let doc: PMNode;
  try {
    doc = PMNode.fromJSON(documentSchema, input);
  } catch (error) {
    return failure("SCHEMA", "", messageOf(error));
  }

  try {
    doc.check();
  } catch (error) {
    const structural = new Issues();
    locateStructuralIssues(doc, input, structural);
    if (!structural.any) structural.add("", messageOf(error));
    return { ok: false, reason: "SCHEMA", errors: structural.list };
  }

  const rules = new Issues();
  checkRules(doc, input, context, rules);
  if (rules.any) return { ok: false, reason: "RULE", errors: rules.list };

  const serialised = JSON.stringify(doc.toJSON());
  const bytes = utf8Length(serialised);
  if (bytes > MAX_DOCUMENT_BYTES) {
    return failure("TOO_LARGE", "", `The canonical document is larger than ${MAX_DOCUMENT_BYTES} bytes`);
  }
  return { ok: true, doc: JSON.parse(serialised) as DocumentJson, bytes };
}
