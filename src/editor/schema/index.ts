// The standard rich-text schema, headless: imported by the editor, the page renderer and the
// server's validator, so a stored document is always one the editor can open (RD-063).
// spec: docs/specs/03-authoring-and-indexing.md sections 1.4 and 1.5 (RD-063)
import { AppError } from "@/domain/errors";
import { documentSchema } from "./schema";
import type { DocumentJson } from "./types";

export { documentSchema, NODE_NAMES, MARK_NAMES } from "./schema";
export { schemaExtensions, STARTER_KIT_BEHAVIOUR_ONLY } from "./extensions";
export {
  validateDocumentJson,
  NODE_ATTRIBUTE_RULES,
  MARK_ATTRIBUTE_RULES,
  MAX_REPORTED_ERRORS,
  type ValidationContext,
  type ValidationFailure,
  type ValidationIssue,
  type ValidationReason,
  type ValidationResult,
  type ValidationSuccess,
} from "./validate";
export {
  collectHeadings,
  indexHeadings,
  slugify,
  Slugger,
  type HeadingEntry,
  type HeadingIdOptions,
  type HeadingIndex,
} from "./headings";
export { formatDateValue } from "./format";
export { CLASS, HEADING_ID_PREFIX, MENTION_PREFIX, NUMBER_COLUMN_WIDTH } from "./dom";
export { Indent, InfoPanel, TableOfContents, Status, DateNode, Mention } from "./nodes";
export {
  MAX_DOCUMENT_BYTES,
  MAX_NODE_DEPTH,
  INDENT_MAX,
  TEXT_ALIGNMENTS,
  PANEL_VARIANTS,
  STATUS_COLOURS,
  STATUS_TEXT_MAX,
  TABLE_WIDTH_MODES,
  ATTACHMENT_PATH_PREFIX,
  classifyHref,
  isAllowedHref,
  isHexColour,
  normaliseColour,
  isCalendarDate,
  isStatusText,
  parseAttachmentSrc,
  isAttachmentSrcFor,
  type HrefKind,
  type PanelVariant,
  type StatusColour,
  type TableWidthMode,
  type TextAlignment,
} from "./rules";
export type { DocumentJson, JsonValue, MarkJson, NodeJson } from "./types";

/**
 * A new, empty document in canonical form: one empty paragraph (`doc` needs a block).
 * A fresh object on every call.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.5
export function emptyDocument(): DocumentJson {
  const node = documentSchema.topNodeType.createAndFill();
  if (!node) throw new AppError("SCHEMA_INVARIANT", "The schema cannot build an empty document");
  return JSON.parse(JSON.stringify(node.toJSON())) as DocumentJson;
}
